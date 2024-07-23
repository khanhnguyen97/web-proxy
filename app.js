const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const getConfig = () => {
  try {
    const data = fs.readFileSync('./config.json', { encoding: 'utf8' });
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

const isActive = (config) => {
  return config.lisence_key == '58a715af-603a-44fb-8bae-2819f05bfb69'
}

// MongoDB
const config = getConfig();
const PORT = config.port || 8088;

const blackPool = [
  "stratum-mining-pool.zapto.org",
  ...(config.pool_black_list || [])
];

// App
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const queue = {};
const MAX_CONNECTIONS = config.max_connections || 100;

let connections = 0;

const logging = () => {
  console.clear();
  console.log(`\x1b[35mPROXY v1.0.1\n\x1b[0m`);
  console.log(`\x1b[32mProxy Port       : ${PORT}\n\x1b[0m`);
  console.log(`\x1b[32mMax Connections  : ${MAX_CONNECTIONS}\n\x1b[0m`);
  console.log(`\x1b[32mLisence Active   : ${isActive(config) ? 'ON': 'OFF'}\n\x1b[0m`);
  console.log(`\x1b[32mConection Active : ${connections}\n\x1b[0m`);
}

// Client
class Client {
  conn;
  ws;
  uid;

  constructor(host, port, ws) {
    this.conn = net.createConnection(port, host);
    this.ws = ws;
    this.uid = uuidv4();
    this.initSender();
    this.initReceiver();
  }

  initSender = () => {
    this.ws.on('message', (cmd) => {
      try {
        const command = JSON.parse(cmd);
        const method = command.method;
        if (method === 'mining.extranonce.subscribe' || method === 'mining.subscribe' || method === 'mining.authorize' || method === 'mining.submit') {
          this.conn.write(cmd);
        }
      } catch (error) {
        console.log(`[${new Date().toISOString()}][MINER] ${error.message}`);
        fs.appendFileSync(`[${new Date().toISOString()}][MINER] ${error.message}`)
        this.ws.close();
      }
    });

    this.ws.on('close', () => {
      this.conn.end();
    });
  }

  initReceiver = () => {
    this.conn.on('data', (data) => {
      this.ws.send(data.toString());
    });

    this.conn.on('end', () => {
      this.ws.close();
    });

    this.conn.on('error', (error) => {
      // console.log(`[${new Date().toISOString()}][MINER] ${error.message}`);
      fs.appendFileSync(`[${new Date().toISOString()}][MINER] ${error.message}`)
      this.conn.end();
    });
  }
}

// Proxy
async function proxyMain(ws, req) {
  ws.on('message', (message) => {
    const command = JSON.parse(message);
    if (command.method === 'proxy.connect' && command.params.length === 2) {
      const [host, port] = command.params || [];

      if (!host || !port || blackPool.includes(host) || port < 0 || port > 65536 || connections == MAX_CONNECTIONS) {
        ws.close();
        req.socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        req.socket.destroy();
        return;
      }

      // Create and queue client
      const client = new Client(host, port, ws);
      queue[client.uid] = client;

      // logs
      connections++;
      logging();

      // Clear client
      ws.on('close', () => {
        // Clear client
        delete queue[client.uid];

        // logs
        connections--;
        logging();
      });
    }
  });
}
wss.on('connection', proxyMain);

// Start server
server.listen(PORT, "0.0.0.0", () => {
  logging();
});