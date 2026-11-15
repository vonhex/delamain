# Meeting notes

Tap the **notebook** icon in the sidebar, give the meeting a title if you like, and press
**Record a meeting**. Put the phone or laptop on the table and leave the page open; the screen
stays on while it records. When the meeting is over, press **Stop & write notes**.

A few minutes later the notes are in your Obsidian vault under `Delamain/Meetings/`, named with
the date, time and title, for example `Delamain/Meetings/2026-11-15 1400 Budget review.md`:

- **Summary**: what the meeting was about and what came of it
- **Decisions**
- **Action items**, as checkboxes (`- [ ] Sam: send the quote (Friday)`)
- **Open questions**
- **Transcript**, in paragraphs with times (`[12:40]`)

Delamain tells you in the chat when they are ready, and the Meeting panel shows the summary.
Afterwards you can simply ask him: "what did we decide in the budget meeting?" or "what are my
action items from this morning's meeting?"

Ask everyone's permission before you record a meeting.

## Everything stays on your computer

The recording is transcribed on the computer Delamain runs on, with
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) on the processor (not the graphics card,
which the language model and his voice need). Your language model writes the notes. Nothing is
sent anywhere else. The first meeting downloads the transcription model once (about 1.6 GB).

Speed: on a 32-core machine the default model transcribes about 16 times faster than real time,
so an hour-long meeting takes about four minutes, plus a minute or two for the notes.

The recording is deleted once the notes are written (unless you turn on *Keep the recording* in
Settings). If anything fails, it is kept, and the meeting shows **Retry**.

## While it records

- The audio is uploaded in 10-second pieces as you go. If the connection drops, the pieces wait
  on the phone and are sent when it comes back; nothing is lost unless the page is closed.
- The wake word is paused, so a meeting that mentions "Delamain" does not set him off.
- You can close the Meeting panel; the recording carries on (the notebook icon shows a red dot).
  Closing or reloading the page asks first, since that would end it.
- One meeting is written up at a time; others wait their turn.

## Settings

Settings → Integrations → **Meeting notes**:

| Setting | Default | |
|---|---|---|
| Transcription model | `large-v3-turbo` | `distil-large-v3` is a little faster for English; `small` or `base` for slow computers, less accurate |
| Meeting language | (detect) | e.g. `en`; set it if detection picks the wrong language |
| Keep the recording | off | keep the audio in `meetings/<id>/` after the notes are written |

Environment: `MEETING_WHISPER_MODEL`, `MEETING_LANGUAGE`, `MEETING_KEEP_AUDIO`, and
`DELAMAIN_MEETINGS_DIR` (where recordings in progress are kept; default `meetings/` next to the app).

## How it works

`meetings.py`. The page records with `MediaRecorder` (Opus in WebM, or MP4 on Safari) and `PUT`s
each piece to `/api/meetings/{id}/chunk/{seq}`. On stop it calls `/finish`, which queues the job.
One worker runs the jobs in turn:

1. join the pieces and decode them with ffmpeg to 16 kHz mono;
2. transcribe with faster-whisper (int8, half the processor cores, voice-activity filter),
   reporting progress; the model is loaded for the job and freed afterwards;
3. summarise with the language model: in one go for a short meeting, or for a long one, notes on
   each part of about 6,000 words and then the notes for the whole meeting from those, so no single
   call needs a large context; these calls show in the Brain view as "Writing up your meeting notes";
4. write the note to the vault and tell every open page (`{"type": "meeting"}` over the WebSocket).

A restart picks up any job it interrupted. The API is in [api.md](api.md#meeting-notes).
