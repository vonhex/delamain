# Google Calendar and Gmail

With Google connected, Delamain can tell you what is on today, tomorrow or this week,
find an event ("when is my dentist appointment?"), add one ("put lunch with Sam on Thursday at
12:30"), move it ("push that to 2") or cancel it when you clearly ask.

With Gmail too, he can tell you about new email ("anything important in my inbox?", "did Sam
reply?"), read one to you, and write replies or new emails. **He never sends email**: everything he
writes is saved as a draft in Gmail, for you to check and send yourself.

It uses **your own** Google Cloud project, so your calendar is only ever shared between Google and
your Delamain server. Setting it up takes about five minutes, once.

## 1. Create the Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in with the Google account whose calendar you use.
2. At the top, open the project picker → **New project**. Name it `Delamain` → **Create**, then select it.
3. Open **APIs & Services → Library**, search for **Google Calendar API** and press **Enable**. Do the
   same for **Gmail API** if you want email.

## 2. The consent screen

1. Open **APIs & Services → OAuth consent screen** (it may be called **Google Auth Platform**) → **Get started**.
2. App name `Delamain`, your email as the support email → **Next**.
3. Audience: **External** → **Next**. Contact email: yours → **Next** → agree → **Create**.
4. Open **Audience** and press **Publish app** → **Confirm**.

   This matters: while an app is in *Testing*, Google signs it out every 7 days. Published, it stays
   connected. It is still private: nobody can use your client without its secret, and Google shows
   an "unverified app" notice only to you when you connect.

## 3. The client

1. Open **Clients** (or **Credentials**) → **Create client** (or *Create credentials → OAuth client ID*).
2. Application type: **Web application**. Name: `Delamain`.
3. Under **Authorised redirect URIs**, press **Add URI** and paste the address shown under the
   **Connect Google Calendar** button in Delamain's Settings. It is the address you open Delamain at,
   followed by `/api/google/callback`, for example:
   - `https://delamain.example.com/api/google/callback`
   - `http://localhost:5000/api/google/callback` (if you also open it on the server itself)

   Add one for each address you will press Connect from. Google only allows `https://` addresses,
   or `http://localhost`, so connect from your HTTPS domain or from the server itself (not from a
   LAN address like `http://192.168.1.20:5000`).
4. **Create**. Copy the **Client ID** and **Client secret**.

## 4. Connect

1. In Delamain: **Settings → Integrations → Google**. Paste the client ID and secret.
2. Press **Connect Google Calendar**. A Google window opens: choose your account. Google warns that
   it "hasn't verified this app": press **Advanced → Go to Delamain (unsafe)**. That is your own app.
3. Tick **all** the permissions (calendar, and Gmail if you want email) and press **Continue**. The window says *Google Calendar is
   connected* and closes.

That's it. Ask him "what's on my calendar today?"

## Adding Gmail to an existing connection

If you connected before email was added (or skipped the Gmail boxes), enable the **Gmail API** in
your Google Cloud project, then press **Add Gmail** in Settings → Integrations → Google and allow
the Gmail permissions. Calendar keeps working throughout.

## What he can and can't do

- Reads every calendar ticked in Google Calendar's sidebar (your own, shared and subscribed ones).
- Adds events to your main calendar, or another of yours when you name it. Moves, renames and
  removes events, always saying what he did. He only removes one when you clearly ask him to.
- Times are in your Google Calendar's time zone.
- Email: reads your inbox (unread mail by default, or any Gmail search such as `from:sam` or
  `newer_than:2d`), reads a message in full, and saves replies (in the right thread) and new emails
  as **drafts**. He has no way to send, delete or archive mail. Email text is treated as information
  only: he is told never to follow instructions written inside an email.
- To disconnect: Settings → Integrations → Google → **Disconnect** (this also revokes his access at
  Google). You can also remove it at <https://myaccount.google.com/permissions>.

## Privacy

The sign-in token is kept on your server, in Delamain's database, and never sent to the browser.
Event details go to your language model when you ask about your calendar, like any other tool
result. If your model is hosted elsewhere, that is where they go.

## How it works

`google_api.py`: the standard OAuth "web server" flow over plain HTTPS (no Google libraries), with
offline access for a refresh token. Scopes: `calendar.readonly` (to see your calendars and events),
`calendar.events` (to add, move and remove), `gmail.readonly` (to read mail), `gmail.compose`
(to save drafts; the code has no send call), plus `openid email` to show which account is connected. The tools are `get_calendar`, `add_calendar_event`, `update_calendar_event` and
`delete_calendar_event`; `get_calendar` labels each event `[E1]`, `[E2]`… for the other three to use.
Email: `get_email` (labels messages `[M1]`…), `read_email`, `draft_reply`, `draft_email`.
API: `GET /api/google/status`, `POST /api/google/connect` `{"origin"}`, `GET /api/google/callback`,
`POST /api/google/disconnect`.
