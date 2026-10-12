# noroo-punchlist

A shared punch list for a home inspection. Everyone opens the same page on their phone, logs each defect with photos, and the list updates live for the whole group.

Made for a pre-move-in inspection of a new apartment, where several people walk the rooms at once and every defect has to end up in one list. The interface is in Korean.

## What it does

- **Log a defect.** A location, a description, and up to 5 photos.
- **Live list.** New and edited entries appear on everyone's screen right away over WebSocket.
- **Edit and delete.** Change the text, add or remove photos. Deleting hides the entry from the list but keeps the record and its photos on disk.
- **One shared password.** No accounts. Anyone with the password can read and write. A login lasts 30 days.
- **No database.** Entries are one JSON file, and photos are files on disk under `data/`.

## Running it

```
npm install
APP_PASSWORD=<password> SESSION_SECRET=<long-random-string> npm start
```

Then open `http://localhost:8000`.

Or with Docker:

```
APP_PASSWORD=<password> SESSION_SECRET=<long-random-string> docker compose up --build
```

The compose file binds to `127.0.0.1:9001` and joins an external Docker network named `dbnet`, because it was written for a server managed with [noroo-deploy](https://github.com/tinynoroo/noroo-deploy). To run it on its own, create the network first (`docker network create dbnet`) or remove the `networks` lines.

| Variable | Meaning |
|---|---|
| `APP_PASSWORD` | The shared password. Required |
| `SESSION_SECRET` | Key used to sign the login cookie. Required |
| `PORT` | Port to listen on (default `8000`) |
| `DATA_DIR` | Where the JSON file and photos are kept (default `./data`) |

## Things to know

- Photo uploads have no size limit. Put a limit in your reverse proxy if the server is reachable from the internet.
- Only image files are accepted.
- It is built for a small group over a few days, not as a multi-tenant service. There is one list and one password.

## Stack

Node.js, Express, `ws`, and `multer`. One server file and three HTML pages, with no build step.
