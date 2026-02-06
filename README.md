# RemixFinder

RemixFinder is a production-ready web app that searches YouTube and Spotify for verified remixes. It uses Groq LLMs to interpret intent and validate remix authenticity, then ranks results by popularity, engagement, and confidence.

## Features

- Natural language input for remix requests
- Groq-powered intent parsing and remix verification
- YouTube + Spotify search with query expansion
- Ranked results with popularity and confidence scoring
- Netlify Serverless Function backend

## Tech Stack

- **Frontend:** React + Vite
- **Backend:** Netlify Functions (`/findRemixes`)
- **LLM:** Groq API (Llama 3)
- **Music APIs:** YouTube Data API v3 + Spotify Web API
- **Deployment:** Netlify

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Fill in `.env` with your API keys:

- `GROQ_API_KEY`
- `YOUTUBE_API_KEY`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

4. Run the app locally:

```bash
npm run dev
```

## Netlify Deployment

- Ensure the environment variables are added to Netlify site settings.
- The function lives at `/.netlify/functions/findRemixes`.
- Requests are proxied from `/findRemixes` using `netlify.toml`.

## API Notes

- YouTube Data API v3: used for video search + stats.
- Spotify Web API: uses client credentials to fetch tracks + popularity.
- Groq LLM: used for intent extraction and remix validation.

## Project Structure

```
/src
  /components
  App.jsx
  main.jsx
/netlify/functions
  findRemixes.js
```

## Development Tips

- Keep API keys in `.env`, never in frontend code.
- Update query expansion logic in `netlify/functions/findRemixes.js` as needed.
- Tune the ranking weights for your audience.
