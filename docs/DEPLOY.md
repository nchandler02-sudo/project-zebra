# Hosting Project Zebra

The server is one small Node process (HTTP plus WebSocket on one port). Rooms live in memory, so run exactly one copy that stays on. It needs about 256 MB of RAM and holds roughly 600 players per room.

## On a laptop (simplest)
```bash
npm install
npm start        # http://localhost:3000/host
```
Open `/host` using the machine's LAN address (the server prints it) so the QR code points phones at the right place.

## Google Cloud Run
A `Dockerfile` is included. Cloud Run needs these settings because rooms live in memory and every WebSocket counts as one request:
```bash
gcloud run deploy project-zebra --source . --region <region> --allow-unauthenticated \
  --concurrency 1000 --min-instances 1 --max-instances 1 --timeout 3600 \
  --set-env-vars ZEBRA_BANK_KEY=<a long random string>
```
Note that Google reserves `/healthz` on Cloud Run, so use `/` for a health check there.

## Any Docker host
```bash
docker build -t project-zebra .
docker run -p 8080:8080 -e ZEBRA_BANK_KEY=<a long random string> project-zebra
```

## Notes
- Set `ZEBRA_BANK_KEY` to keep the answer-bank page (`/bank?key=...`) private. It lists every answer, so do not share that link with players.
- Some hospital and school networks block certain hosting domains. Test your link on the network you will use before the session.
- After deploying, open `/host`, start a room and join from a phone to confirm WebSockets work.
- To update the question bank, edit the JSON files in `data/` and redeploy.
