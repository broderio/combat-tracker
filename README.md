# ⚔️ D&D Combat Tracker

Run a live combat board for your table. The server hosts the app, and players join from a browser.

## Quick start

**You’ll need [Node.js 20 or newer](https://nodejs.org/).** The rules data is generated locally and is not included in a fresh checkout.

From the repository root, prepare the rules database once:

```bash
cd dbbuilder
npm install
npm run fetch
npm run fetch:catalogs
npm run build
cd ..
```

Then install and start the tracker:

```bash
npm install
npm start
```

Open **http://localhost:3000**. Sign in as the DM with the initial credentials `dm` / `0000`; change the PIN in `data/db.json` before hosting a real game. Players can create their own account by entering a username and PIN.

## Invite players

Players on your local network can use the network address printed by the server. To invite players over the internet, expose port `3000` with a tunneling service such as [ngrok](https://ngrok.com), then share its HTTPS forwarding URL:

```bash
ngrok http 3000
```

Keep the tracker server and tunnel running while you play.

## Rules database

The tracker reads generated rules from `dbbuilder/data/rules/`. To refresh that data later, rerun the `dbbuilder` commands above. See [dbbuilder/README.md](dbbuilder/README.md) for details.
