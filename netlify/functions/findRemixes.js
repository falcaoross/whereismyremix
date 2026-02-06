

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_SEARCH_URL = 'https://api.spotify.com/v1/search';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const safeJsonParse = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};



const callGroq = async ({ apiKey, messages, temperature = 0.2 }) => {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages,
      temperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq error: ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '{}';
};

const extractIntent = async ({ apiKey, query }) => {
  const content = await callGroq({
    apiKey,
    messages: [
      {
        role: 'system',
        content:
          'You extract structured intent from remix-related music queries. Respond ONLY with valid JSON.',
      },
      {
        role: 'user',
        content: `
Extract remix search intent from:
"${query}"

Return JSON exactly like:
{
  "song": string,
  "artist": string,
  "genrePreference": string
}
`,
      },
    ],
  });

  return safeJsonParse(content, {
    song: query,
    artist: '',
    genrePreference: '',
  });
};


const buildQueries = ({ song, artist, genrePreference }) => {
  const base = song?.trim() || '';
  const artistPart = artist ? ` ${artist}` : '';
  const genrePart = genrePreference ? ` ${genrePreference}` : '';

  return [
    `${base} remix`,
    `${base}${artistPart} remix`,
    `${base} EDM remix`,
    `${base} DJ remix`,
    `${base}${genrePart} remix`,
  ].filter(Boolean);
};


const searchYouTube = async ({ apiKey, queries }) => {
  const results = [];
  const seen = new Set();

  for (const query of queries) {
    const searchParams = new URLSearchParams({
      key: apiKey,
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: '5',
    });

    const searchRes = await fetch(`${YOUTUBE_SEARCH_URL}?${searchParams}`);
    if (!searchRes.ok) continue;

    const searchData = await searchRes.json();
    const ids = (searchData.items || [])
      .map((item) => item.id?.videoId)
      .filter(Boolean)
      .filter((id) => !seen.has(id));

    ids.forEach((id) => seen.add(id));
    if (!ids.length) continue;

    const statsParams = new URLSearchParams({
      key: apiKey,
      part: 'snippet,statistics',
      id: ids.join(','),
    });

    const statsRes = await fetch(`${YOUTUBE_VIDEOS_URL}?${statsParams}`);
    if (!statsRes.ok) continue;

    const statsData = await statsRes.json();

    statsData.items?.forEach((item) => {
      results.push({
        id: item.id,
        title: item.snippet?.title,
        artist: item.snippet?.channelTitle,
        viewCount: Number(item.statistics?.viewCount || 0),
        likeCount: Number(item.statistics?.likeCount || 0),
        url: `https://www.youtube.com/watch?v=${item.id}`,
        platform: 'YouTube',
      });
    });
  }

  return results;
};



const getSpotifyToken = async ({ clientId, clientSecret }) => {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });

  if (!response.ok) {
    throw new Error('Failed to authenticate with Spotify');
  }

  const data = await response.json();
  return data.access_token;
};

const searchSpotify = async ({ token, queries }) => {
  const results = [];
  const seen = new Set();

  for (const query of queries) {
    const params = new URLSearchParams({
      q: query,
      type: 'track',
      limit: '5',
    });

    const res = await fetch(`${SPOTIFY_SEARCH_URL}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) continue;

    const data = await res.json();
    data.tracks?.items?.forEach((track) => {
      if (seen.has(track.id)) return;
      seen.add(track.id);

      results.push({
        id: track.id,
        title: track.name,
        artist: track.artists.map((a) => a.name).join(', '),
        popularity: track.popularity,
        url: track.external_urls.spotify,
        platform: 'Spotify',
      });
    });
  }

  return results;
};



const computeScores = (items) => {
  const maxViews = Math.max(
    1,
    ...items.filter((i) => i.platform === 'YouTube').map((i) => i.viewCount || 0)
  );

  return items.map((item) => {
    const popularityScore =
      item.platform === 'YouTube'
        ? (item.viewCount || 0) / maxViews
        : (item.popularity || 0) / 100;

    const score = popularityScore * 0.8 + 0.2;

    return { ...item, score };
  });
};


exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const {
    GROQ_API_KEY,
    YOUTUBE_API_KEY,
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
  } = process.env;

  if (!GROQ_API_KEY || !YOUTUBE_API_KEY || !SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing API keys in Netlify env vars' }),
    };
  }

  const body = safeJsonParse(event.body, {});
  const query = body.query?.trim();

  if (!query) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };
  }

  try {
    const intent = await extractIntent({ apiKey: GROQ_API_KEY, query });
    const queries = buildQueries(intent);

    const [youtubeResults, spotifyToken] = await Promise.all([
      searchYouTube({ apiKey: YOUTUBE_API_KEY, queries }),
      getSpotifyToken({
        clientId: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET,
      }),
    ]);

    const spotifyResults = await searchSpotify({ token: spotifyToken, queries });

    const combined = [...youtubeResults, ...spotifyResults].slice(0, 12);
    const scored = computeScores(combined);

    const results = scored
      .sort((a, b) => b.score - a.score)
      .map((item) => ({
        title: item.title,
        artist: item.artist,
        platform: item.platform,
        score: Number(item.score.toFixed(4)),
        url: item.url,
        popularity:
          item.platform === 'YouTube'
            ? `${item.viewCount.toLocaleString()} views`
            : item.popularity,
        type: 'Remix',
      }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        found: results.length > 0,
        results,
        intent,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
