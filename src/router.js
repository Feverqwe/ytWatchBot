import ErrorWithCode from "./tools/errorWithCode";

const debug = require('debug')('app:router');
const qs = require('querystring');

const messageTypes = [
  'text', 'audio', 'document', 'photo', 'sticker', 'video', 'voice', 'contact',
  'location', 'new_chat_participant', 'left_chat_participant', 'new_chat_title',
  'new_chat_photo', 'delete_chat_photo', 'group_chat_created'
];

class Router {
  constructor(/**Main*/main) {
    this.botNameRe = new RegExp('^' + main.botName + '$', 'i');

    this.stack = [];

    main.bot.on('message', this.handle.bind(this, 'message'));
    main.bot.on('callback_query', this.handle.bind(this, 'callback_query'));

    this.handle = this.handle.bind(this);

    messageTypes.forEach((type) => {
      /**
       * @param {RegExp} [re]
       * @param {...function(RouterReq, function())} callbacks
       */
      this[type] = (re, ...callbacks) => {
        const args = prepareArgs([re, ...callbacks]);

        args.callbackList.forEach((callback) => {
          this.stack.push(new RouterRoute({
            event: 'message',
            type: type
          }, args.re, callback));
        });
      };
    });
  }

  /**
   * @param {string} event
   * @param {Object} message
   */
  handle(event, message) {
    let index = 0;
    const req = new RouterReq(event, message);
    const firstCommand = getCommands(event, message, this.botNameRe)[0];
    const next = () => {
      const route = this.stack[index++];
      if (!route) return;

      req.params = route.getParams(firstCommand);

      if (route.match(req)) {
        return route.dispatch(req, next);
      }

      next();
    };
    next();
  }

  /**
   * @param {RegExp} [re]
   * @param {...function(RouterReq, function())} callbacks
   */
  all(re, ...callbacks) {
    const args = prepareArgs([re, ...callbacks]);

    args.callbackList.forEach((callback) => {
      this.stack.push(new RouterRoute({}, args.re, callback));
    });
  }

  /**
   * @param {RegExp} [re]
   * @param {...function(RouterReq, function())} [callbacks]
   */
  message(re, ...callbacks) {
    const args = prepareArgs([re, ...callbacks]);

    args.callbackList.forEach((callback) => {
      this.stack.push(new RouterRoute({
        event: 'message'
      }, args.re, callback));
    });
  }

  /**
   * @param {RegExp} [re]
   * @param {...function(RouterReq, function())} [callbacks]
   */
  callback_query(re, ...callbacks) {
    const args = prepareArgs([re, ...callbacks]);

    args.callbackList.forEach((callback) => {
      this.stack.push(new RouterRoute({
        event: 'callback_query'
      }, args.re, callback));
    });
  }

  /**
   * @param {String[]} methods
   * @returns {function(RegExp, function(RouterReq, function()))}
   */
  custom(methods) {
    return (re, ...callbacks) => {
      const args = [re, ...callbacks];
      methods.forEach((method) => {
        this[method].apply(this, args);
      });
    };
  }

  /**
   * @param {RegExp} [re]
   * @param {{}} details
   * @param {String} details.event
   * @param {String} details.type
   * @param {String} details.fromId
   * @param {String} details.chatId
   * @param {number} timeoutSec
   * @return {Promise.<RouterReq>}
   */
  waitResponse(re, details, timeoutSec) {
    if (!(re instanceof RegExp)) {
      timeoutSec = details;
      details = re;
      re = null;
    }
    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        callback(new ErrorWithCode('ETIMEDOUT', 'RESPONSE_TIMEOUT'));
      }, timeoutSec * 1000);

      const callback = (err, req) => {
        const pos = this.stack.indexOf(route);
        if (pos !== -1) {
          this.stack.splice(pos, 1);
        }

        clearTimeout(timeoutTimer);

        err ? reject(err) : resolve(req);
      };

      const route = new RouterRoute(details, re, (/*Req*/req, next) => {
        if (details.throwOnCommand) {
          const entities = req.entities;
          if (entities.bot_command) {
            callback(new ErrorWithCode('BOT_COMMAND', 'BOT_GOT_COMMAND'));
            next();
          } else {
            callback(null, req);
          }
        } else {
          callback(null, req);
        }
      });

      this.stack.unshift(route);
    });
  }
}

class RouterRoute {
  /**
   * @param {{}} details
   * @param {string} details.event
   * @param {string} details.type
   * @param {String} details.fromId
   * @param {String} details.chatId
   * @param {RegExp} re
   * @param {function(Object, function())} callback
   * @constructor
   */
  constructor(details, re, callback) {
    this.re = re;
    this.event = details.event;
    this.type = details.type;
    this.fromId = details.fromId;
    this.chatId = details.chatId;
    this.dispatch = (req, next) => {
      try {
        callback(req, next);
      } catch (err) {
        debug('Dispatch error', err);
      }
    };
  }

  /**
   * @param {String} command
   * @return {[]|null}
   */
  getParams(command) {
    if (!this.re) {
      return [];
    }

    let params = this.re.exec(command);
    if (params) {
      params.shift();
    }
    return params;
  }

  /**
   * @param {RouterReq} req
   * @return {boolean}
   */
  match(req) {
    if (!req.params) {
      return false;
    }
    if (this.event && !req[this.event]) {
      return false;
    }
    if (this.type && !req[this.event][this.type]) {
      return false;
    }
    if (this.chatId && req.chatId != this.chatId) {
      return false;
    }
    if (this.fromId && req.fromId != this.fromId) {
      return false;
    }
    return true;
  }
}

class RouterReq {
  constructor(event, message) {
    this.event = event;
    this[event] = message;
  }

  getFromId() {
    return this.fromId;
  }

  getChatId() {
    return this.chatId;
  }

  getMessageId() {
    return this.messageId;
  }

  getQuery() {
    return this.query;
  }

  getEntities() {
    return this.entities;
  }

  get fromId() {
    let from = null;
    if (this.message) {
      from = this.message.from;
    } else
    if (this.callback_query) {
      from = this.callback_query.from;
    }
    return from && from.id;
  }

  get chatId() {
    const message = this._message;
    return message && message.chat.id;
  }

  get messageId() {
    const message = this._message;
    return message && message.message_id;
  }

  get query() {
    let query = {};
    if (!this.callback_query) return query;

    const text = this.callback_query.data;
    const re = /\?([^\s]+)/;
    const m = re.exec(text);
    if (m) {
      query = qs.parse(m[1]);
    }
    return query;
  }

  get entities() {
    const entities = {};
    if (!this.message || !this.message.entities) return entities;

    this.message.entities.forEach((entity) => {
      let array = entities[entity.type];
      if (!array) {
        array = entities[entity.type] = [];
      }
      array.push({
        type: entity.type,
        value: this.message.text.substr(entity.offset, entity.length),
        url: entity.url,
        user: entity.user
      });
    });
    return entities;
  }

  get _message() {
    let message = null;
    if (this.message) {
      message = this.message;
    } else
    if (this.callback_query) {
      message = this.callback_query.message;
    }
    return message;
  }
}

/**
 * @param {[]} args
 * @return {{re: RegExp, callbackList: [function]}}
 */
function prepareArgs(args) {
  let re = null;
  if (typeof args[0] !== 'function') {
    re = args.shift();
  }
  return {
    re: re,
    callbackList: args
  }
}

/**
 * @param {String} event
 * @param {Object} message
 * @param {RegExp} botNameRe
 * @return {String[]|null}
 */
function getCommands(event, message, botNameRe) {
  const commands = [];
  if (event === 'message' && message.text && message.entities) {
    const text = message.text;
    const entities = message.entities.slice(0).reverse();
    let end = text.length;
    entities.forEach((entity) => {
      if (entity.type === 'bot_command') {
        let botName = null;
        let command = text.substr(entity.offset, entity.length);
        const m = /([^@]+)(?:@(.+))?/.exec(command);
        if (m) {
          command = m[1];
          botName = m[2];
        }
        const start = entity.offset + entity.length;
        const args = text.substr(start, end - start);
        if (args) {
          command += args;
        }
        if (!botName || botNameRe.test(botName)) {
          commands.unshift(command);
        }
        end = entity.offset;
      }
    });
  } else
  if (event === 'callback_query') {
    commands.push(message.data);
  }
  return commands;
}

export default Router;