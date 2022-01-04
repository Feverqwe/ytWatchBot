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
    this.main = main;
    this._botNameRe = null;

    this.stack = [];

    /**
     * @param {RegExp} [re]
     * @param {...function(RouterReq, RouterRes, function())} callbacks
     */
    this.text = (re, ...callbacks) => {};

    messageTypes.forEach((type) => {
      /**
       * @param {RegExp} [re]
       * @param {...function(RouterReq, RouterRes, function())} callbacks
       */
      this[type] = (re, ...callbacks) => {
        const args = prepareArgs(re, ...callbacks);

        args.callbackList.forEach((callback) => {
          this.stack.push(new RouterRoute({
            event: 'message',
            type: type
          }, args.re, callback));
        });
      };
    });
  }

  get botNameRe() {
    if (!this._botNameRe) {
      this._botNameRe = new RegExp('^' + this.main.botName + '$', 'i');
    }
    return this._botNameRe;
  }

  /**
   * @param {string} event
   * @param {Object} data
   */
  handle = (event, data) => {
    const commands = getCommands(event, data, this.botNameRe);
    if (!commands.length) {
      commands.push('');
    }
    commands.forEach((command) => {
      const req = new RouterReq(event, data);
      const res = new RouterRes(this.main.bot, req);
      let index = 0;
      const next = () => {
        const route = this.stack[index++];
        if (!route) return;

        req.commands = commands;
        req.command = command;
        req.params = route.getParams(command);

        if (route.match(req)) {
          return route.dispatch(req, res, next);
        }

        next();
      };
      next();
    });
  };

  /**
   * @param {RegExp} [re]
   * @param {...function(RouterReq, RouterRes, function())} callbacks
   */
  all(re, ...callbacks) {
    const args = prepareArgs(re, ...callbacks);

    args.callbackList.forEach((callback) => {
      this.stack.push(new RouterRoute({}, args.re, callback));
    });
  }

  /**
   * @param {RegExp} [re]
   * @param {...function(RouterReq, RouterRes, function())} [callbacks]
   */
  message(re, ...callbacks) {
    const args = prepareArgs(re, ...callbacks);

    args.callbackList.forEach((callback) => {
      this.stack.push(new RouterRoute({
        event: 'message'
      }, args.re, callback));
    });
  }

  /**
   * @param {RegExp} [re]
   * @param {...function(RouterReq, RouterRes, function())} [callbacks]
   */
  callback_query(re, ...callbacks) {
    const args = prepareArgs(re, ...callbacks);

    args.callbackList.forEach((callback) => {
      this.stack.push(new RouterRoute({
        event: 'callback_query'
      }, args.re, callback));
    });
  }

  /**
   * @param {String[]} methods
   * @returns {function(RegExp, ...function(RouterReq, RouterRes, function()))}
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
   * @return {Promise.<{req:RouterReq, res:RouterRes, next:function()}>}
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

      const callback = (err, result) => {
        const pos = this.stack.indexOf(route);
        if (pos !== -1) {
          this.stack.splice(pos, 1);
        }

        clearTimeout(timeoutTimer);

        err ? reject(err) : resolve(result);
      };

      const route = new RouterRoute(details, re, (/*RouterReq*/req, /*RouterRes*/res, next) => {
        if (details.throwOnCommand) {
          const entities = req.entities;
          if (entities.bot_command) {
            callback(new ErrorWithCode('BOT_COMMAND', 'RESPONSE_COMMAND'));
            next();
          } else {
            callback(null, {req, res, next});
          }
        } else {
          callback(null, {req, res, next});
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
    this.dispatch = (req, res, next) => {
      try {
        callback(req, res, next);
      } catch (err) {
        debug('Dispatch error %o', err);
      }
    };
  }

  /**
   * @param {String} command
   * @return {Object|null}
   */
  getParams(command) {
    if (!this.re) {
      return {};
    }

    let result = null;
    if (this.re) {
      const m = this.re.exec(command);
      if (m) {
        result = m.groups || {};
      }
    }
    return result;
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
  constructor(event, data) {
    this.commands = null;
    this.command = null;
    this.params = null;
    this.event = event;
    switch (event) {
      case 'message': {
        this.message = data;
        break;
      }
      case 'callback_query': {
        this.callback_query = data;
        break;
      }
      default: {
        throw new Error(`Unknown case ${event}`);
      }
    }
    this._cache = {};
  }

  get fromId() {
    return this._useCache('fromId', () => {
      let from = null;
      if (this.message) {
        from = this.message.from;
      } else
      if (this.callback_query) {
        from = this.callback_query.from;
      }
      return from && from.id;
    });
  }

  get chatId() {
    return this._useCache('chatId', () => {
      const message = this._findMessage();
      return message && message.chat.id;
    });
  }

  get chatType() {
    return this._useCache('chatType', () => {
      const message = this._findMessage();
      return message && message.chat.type;
    });
  }

  get messageId() {
    return this._useCache('messageId', () => {
      const message = this._findMessage();
      return message && message.message_id;
    });
  }

  get query() {
    return this._useCache('query', () => {
      let query = {};
      if (!this.callback_query) return Object.freeze(query);

      const text = this.callback_query.data;
      const re = /\?([^\s]+)/;
      const m = re.exec(text);
      if (m) {
        const queryStr = m[1];
        if (/^[\[{]/.test(queryStr)) {
          query = JSON.parse(queryStr);
        } else {
          query = qs.parse(m[1]);
        }
      }
      return Object.freeze(query);
    });
  }

  get entities() {
    return this._useCache('entities', () => {
      const entities = {};
      if (!this.message || !this.message.entities) return Object.freeze(entities);
      this.message.entities.forEach((entity) => {
        let array = entities[entity.type];
        if (!array) {
          array = entities[entity.type] = [];
        }
        array.push({
          type: entity.type,
          value: this.message.text.substring(entity.offset, entity.offset + entity.length),
          url: entity.url,
          user: entity.user
        });
      });
      return Object.freeze(entities);
    });
  }

  _findMessage() {
    let message = null;
    if (this.message) {
      message = this.message;
    } else
    if (this.callback_query) {
      message = this.callback_query.message;
    }
    return message;
  }

  _useCache(key, fn) {
    let cache = this._cache[key];
    if (!cache) {
      cache = this._cache[key] = {};
      cache.value = fn();
    }
    return cache.value;
  }
}

class RouterRes {
  constructor(bot, req) {
    this.bot = bot;
    this.req = req;
  }
}

/**
 * @param {RegExp|function} [re]
 * @param {function[]} callbacks
 * @return {{re: RegExp, callbackList: [function]}}
 */
function prepareArgs(re, ...callbacks) {
  if (typeof re === 'function') {
    callbacks.unshift(re);
    re = null;
  }
  return {
    re: re,
    callbackList: callbacks
  };
}

/**
 * @param {String} event
 * @param {Object} data
 * @param {RegExp} botNameRe
 * @return {String[]|null}
 */
function getCommands(event, data, botNameRe) {
  const commands = [];
  switch (event) {
    case 'message': {
      const message = data;
      if (message.text && message.entities) {
        const text = message.text;
        const entities = message.entities.slice(0).reverse();
        let end = text.length;
        entities.forEach((entity) => {
          if (entity.type === 'bot_command') {
            let botName = null;
            let command = text.substring(entity.offset, entity.offset + entity.length);
            const m = /([^@]+)(?:@(.+))?/.exec(command);
            if (m) {
              command = m[1];
              botName = m[2];
            }
            const start = entity.offset + entity.length;
            const args = text.substring(start, end);
            if (args) {
              command += args;
            }
            if (!botName || botNameRe.test(botName)) {
              commands.unshift(command);
            }
            end = entity.offset;
          }
        });
      }
      break;
    }
    case 'callback_query': {
      const callbackQuery = data;
      commands.push(callbackQuery.data);
      break;
    }
  }
  return commands;
}

export default Router;