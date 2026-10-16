# Combat Tracker

A real-time combat tracker you run from your own laptop and share with your players over the internet.

## 1. Install

You need [Node.js](https://nodejs.org) (v18+) installed on the laptop that will host the game.

```bash
cd dnd5e-combat-tracker
npm install
```

## 2. Run

```bash
npm start
```

You'll see:

```
DnD Combat Tracker running:
  Local:   http://localhost:3000
  Network: http://<your-lan-ip>:3000
```

Open `http://localhost:3000` yourself to confirm it works before inviting anyone.

## 3. Getting Your Players Connected

Your laptop isn't normally reachable from the internet, so you must use a tunneling tool to let players connect to your server that are not on your local network.

### ngrok

Using [ngrok](https://ngrok.com) makes this step easy. Sign up for a free account, install the ngrok CLI, and run:

```bash
ngrok config add-authtoken <your-token>
ngrok http 3000
```

You should see an output similar to:

```
Session Status                online
Account                       <your-account> (Plan: Free)
Version                       3.39.11
Region                        <your-region>
Latency                       34ms
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://<unique-subdomain>.ngrok-free.dev -> http://localhost:3000
```

Send the `https://<unique-subdomain>.ngrok-free.dev` URL to your players. They can open it in their browser and join your game.
