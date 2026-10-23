# Privacy Policy for Delamain

**Last updated: October 23, 2026**

## Overview

Delamain is a self-hosted voice assistant that runs in a web browser. You run the backend yourself; this policy explains what it does with your data.

## Microphone Access

The browser asks for microphone access when you press the Talk button. Speech is turned into text by the browser's built-in speech recognition. In Chrome and Android browsers that service is provided by Google, so your spoken audio is processed under Google's terms. Delamain receives only the resulting text and never records audio.

## Location

If you allow it, the browser shares your approximate position with your Delamain server for "near me" questions, local news and navigation.

## What is stored

- **Conversation log**: what you say and what Delamain replies are saved in the SQLite database on your server (`delamain.db`), viewable in the conversation log panel. The last 30 minutes are reloaded when you reconnect.
- **Reminders**: the text and time of each reminder are saved in the same database.
- **Notes and memory**: notes, reminders and long-term memory are written as Markdown files in the Obsidian vault you configure, under `Delamain/`. You can read, edit or delete them at any time.
- **Voice clips**: synthesized replies are saved as WAV files in `audio_output/` on your server.

Delamain has no analytics, tracking or advertising, and nothing is sent to the project's authors.

## Services Delamain contacts

Your server contacts only the services needed to answer you:

- **Your LLM endpoint** (`LLM_URL`): receives the conversation, your rough location and your memory notes in order to write replies. If you point it at a hosted provider, that provider's terms apply.
- **SearXNG** (`SEARXNG_URL`): receives web search queries. It is usually self-hosted.
- **Google News RSS**: receives the news topic or town you ask about.
- **OpenStreetMap Nominatim**: receives your coordinates, to name the nearby town, and the names of places you navigate to or ask about.
- **Open-Meteo**: receives the coordinates of the place you ask the weather for.
- **OSRM** (by default its public demo server): receives the start and end coordinates when you ask how long a drive will take.
- **Public web pages**: fetched when Delamain reads a search result for detail.

## Contact

For questions about this policy, contact: necropsyk@gmail.com
