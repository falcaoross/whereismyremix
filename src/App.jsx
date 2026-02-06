import { useState } from 'react';

const initialState = {
  query: '',
  loading: false,
  error: '',
  results: [],
};

const platformStyles = {
  YouTube: {
    background: '#FEF2F2',
    color: '#DC2626',
    border: '1px solid #FECACA',
  },
  Spotify: {
    background: '#ECFDF3',
    color: '#16A34A',
    border: '1px solid #BBF7D0',
  },
};

const formatScore = (score) => {
  if (Number.isNaN(score)) return '0.00';
  return score.toFixed(2);
};

export default function App() {
  const [state, setState] = useState(initialState);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!state.query.trim()) {
      setState((prev) => ({ ...prev, error: 'Ask about a song or remix first.' }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: '', results: [] }));

    try {
      const response = await fetch('/findRemixes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: state.query }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Unable to find remixes right now.');
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        results: data.results || [],
        error: data.found ? '' : 'No verified remixes found yet.',
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error.message || 'Something went wrong.',
      }));
    }
  };

  return (
    <div className="app">
      <header className="hero">
        <span className="badge">RemixFinder</span>
        <h1>Find real remixes across YouTube + Spotify</h1>
        <p>
          Ask about any song, and RemixFinder will search, verify, and rank authentic
          remixes ready to play.
        </p>
      </header>

      <form className="search" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder='Try "Is there a remix of Kasoor?"'
          value={state.query}
          onChange={(event) =>
            setState((prev) => ({ ...prev, query: event.target.value }))
          }
        />
        <button type="submit" disabled={state.loading}>
          {state.loading ? 'Searching...' : 'Find remixes'}
        </button>
      </form>

      {state.error && <div className="error">{state.error}</div>}

      <section className="results">
        {state.loading && (
          <div className="loading">
            <span className="loader" />
            <div>
              <h3>Searching for verified remixes</h3>
              <p>We are checking YouTube and Spotify for true remixes.</p>
            </div>
          </div>
        )}

        {!state.loading && state.results.length > 0 && (
          <div className="grid">
            {state.results.map((item) => (
              <article key={`${item.platform}-${item.url}`} className="card">
                <div className="card-header">
                  <span
                    className="platform"
                    style={platformStyles[item.platform]}
                  >
                    {item.platform}
                  </span>
                  <span className="score">Score {formatScore(item.score)}</span>
                </div>
                <h3>{item.title}</h3>
                <p className="artist">{item.artist || 'Unknown artist'}</p>
                <div className="meta">
                  <span className="type">{item.type}</span>
                  <span className="popularity">Popularity {item.popularity}</span>
                </div>
                <a className="listen" href={item.url} target="_blank" rel="noreferrer">
                  Listen
                </a>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
