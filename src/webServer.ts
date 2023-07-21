import Main from './main';
import YtPubSub from './ytPubSub';
import {Server} from 'http';
import express from 'express';
import {appConfig} from './appConfig';

class WebServer {
  public ytPubSub: YtPubSub;
  private server: Server | undefined;
  private app = express();
  private host = appConfig.webServer.host || 'localhost';
  private port = appConfig.webServer.port;

  constructor(private main: Main) {
    this.ytPubSub = new YtPubSub(this.main);
  }

  init() {
    this.initApi();
    this.ytPubSub.init(this.app);

    return new Promise<void>((resolve) => {
      this.server = this.app.listen(this.port, this.host, resolve);
    });
  }

  initApi() {
  }
}

export default WebServer;
