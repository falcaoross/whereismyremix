const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_SEARCH_URL = 'https://api.spotify.com/v1/search';

const jsonHeaders = {
  'Content-Type': 'application/json',
};

const safeJsonParse = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

const callGroq = async ({ apiKey, messages, temperature = 0.2 }) => {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      ...jsonHeaders,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      messages,
      temperature,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error: ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '{}';
};

const extractIntent = async ({ apiKey, query }) => {
  const content = await callGroq({
    apiKey,
    messages: [
      {
        role: 'system',
        content:
          'You are a music assistant. Extract structured intent for remix requests. Respond with strict JSON only.',
      },
      {
        role: 'user',
        content: `Extract the song name, artist if mentioned, request type, and any genre preference from: "${query}". Return JSON with keys: song, artist, requestType, genrePreference.`,
      },
    ],
  });

  return safeJsonParse(content, {
    song: query,
    artist: '',
    requestType: 'remix',
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
    `${base} DJ remix`,
    `${base} EDM remix`,
    `${base}${genrePart} remix`,
  ].filter(Boolean);
};

const searchYouTube = async ({ apiKey, queries }) => {
  const results = [];
  const seenIds = new Set();

  for (const query of queries) {
    const searchParams = new URLSearchParams({
      key: apiKey,
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: '5',
    });

    const response = await fetch(`${YOUTUBE_SEARCH_URL}?${searchParams.toString()}`);
    if (!response.ok) {
      continue;
    }

    const data = await response.json();
    const ids = data.items?.map((item) => item.id?.videoId).filter(Boolean) || [];
    const uniqueIds = ids.filter((id) => !seenIds.has(id));
    uniqueIds.forEach((id) => seenIds.add(id));

    if (uniqueIds.length === 0) {
      continue;
    }

    const statsParams = new URLSearchParams({
      key: apiKey,
      part: 'snippet,statistics',
      id: uniqueIds.join(','),
      maxResults: uniqueIds.length.toString(),
    });

    const statsResponse = await fetch(`${YOUTUBE_VIDEOS_URL}?${statsParams.toString()}`);
    if (!statsResponse.ok) {
      continue;
    }

    const statsData = await statsResponse.json();
    statsData.items?.forEach((item) => {
      results.push({
        id: item.id,
        title: item.snippet?.title,
        channelTitle: item.snippet?.channelTitle,
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
    body: new URLSearchParams({
      grant_type: 'client_credentials',
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Spotify token error: ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
};

const searchSpotify = async ({ token, queries }) => {
  const results = [];
  const seenIds = new Set();

  for (const query of queries) {
    const searchParams = new URLSearchParams({
      q: query,
      type: 'track',
      limit: '5',
    });

    const response = await fetch(`${SPOTIFY_SEARCH_URL}?${searchParams.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      continue;
    }

    const data = await response.json();
    const tracks = data.tracks?.items || [];

    tracks.forEach((track) => {
      if (seenIds.has(track.id)) {
        return;
      }
      seenIds.add(track.id);
      results.push({
        id: track.id,
        title: track.name,
        artist: track.artists?.map((artist) => artist.name).join(', '),
        popularity: Number(track.popularity || 0),
        url: track.external_urls?.spotify,
        platform: 'Spotify',
      });
    });
  }

  return results;
};

const validateRemix = async ({ apiKey, item }) => {
  const prompt = `Determine if the following is a true remix. Reject slowed+reverb, nightcore, lyric videos, or unrelated covers.\nTitle: ${item.title}\nArtist/Channel: ${item.artist || item.channelTitle || 'Unknown'}\nReturn JSON: {"isRemix": boolean, "type": "EDM Remix | Rock Remix | Other", "confidence": number}`;

  const content = await callGroq({
    apiKey,
    messages: [
      {
        role: 'system',
        content: 'You are a strict remix verifier. Respond with strict JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.1,
  });

  return safeJsonParse(content, {
    isRemix: false,
    type: 'Other',
    confidence: 0,
  });
};

const computeScores = (items) => {
  const maxViews = Math.max(
    1,
    ...items.filter((item) => item.platform === 'YouTube').map((item) => item.viewCount || 0)
  );
  const maxPopularity = Math.max(
    1,
    ...items
      .filter((item) => item.platform === 'Spotify')
      .map((item) => item.popularity || 0)
  );

  return items.map((item) => {
    const popularityScore =
      item.platform === 'YouTube'
        ? (item.viewCount || 0) / maxViews
        : (item.popularity || 0) / maxPopularity;
    const likeRatio =
      item.platform === 'YouTube'
        ? (item.likeCount || 0) / Math.max(1, item.viewCount || 1)
        : 0.8;
    const score =
      popularityScore * 0.5 +
      likeRatio * 0.2 +
      (item.validation?.confidence || 0) * 0.3;

    return {
      ...item,
      score,
    };
  });
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
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
      body: JSON.stringify({
        error: 'Missing API keys. Please set environment variables on Netlify.',
      }),
    };
  }

  const body = safeJsonParse(event.body, {});
  const query = body.query?.toString() || '';

  if (!query.trim()) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Query is required.' }),
    };
  }

  try {
    const intent = await extractIntent({ apiKey: GROQ_API_KEY, query });
    const queries = buildQueries(intent);

    const [youtubeResults, spotifyToken] = await Promise.all([
      searchYouTube({ apiKey: YOUTUBE_API_KEY, queries }),
      getSpotifyToken({ clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET }),
    ]);

    const spotifyResults = await searchSpotify({ token: spotifyToken, queries });

    const candidates = [...youtubeResults, ...spotifyResults].slice(0, 12);

    const validated = await Promise.all(
      candidates.map(async (item) => {
        const validation = await validateRemix({ apiKey: GROQ_API_KEY, item });
        return {
          ...item,
          validation,
        };
      })
    );

    const verified = validated.filter((item) => item.validation?.isRemix);
    const scored = computeScores(verified);

    const results = scored
      .sort((a, b) => b.score - a.score)
      .map((item) => ({
        title: item.title,
        artist: item.artist || item.channelTitle || '',
        platform: item.platform,
        type: item.validation?.type || 'Other',
        score: Number(item.score.toFixed(4)),
        url: item.url,
        popularity:
          item.platform === 'YouTube'
            ? `${item.viewCount?.toLocaleString?.() || item.viewCount} views`
            : item.popularity,
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
      body: JSON.stringify({ error: error.message || 'Server error.' }),
    };
  }
};
