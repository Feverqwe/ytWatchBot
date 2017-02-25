/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const debug = require('debug')('app:index');
const base = require('./base');
const PushApi = require('./pushApi');
const Checker = require('./checker');
const Chat = require('./chat');
const TelegramBot = require('node-telegram-bot-api');
const EventEmitter = require('events');
const Daemon = require('./daemon');
const Tracker = require('./tracker');
const MsgStack = require('./msgStack');
const MsgSender = require('./msgSender');
const Users = require('./users');
const Db = require('./db');
const Locale = require('./locale');

var options = {
    config: {},
    serviceList: ['youtube'],
    serviceToTitle: {
        youtube: 'Youtube'
    },
    serviceMatchRe: {
        youtube: [
            /youtube\.com\/(?:#\/)?(?:user|channel)\/([0-9A-Za-z_-]+)/i,
            /youtube\.com\/([0-9A-Za-z_-]+)$/i
        ]
    },
    services: {},
    events: null,
    tracker: null,
    db: null
};

(function() {
    options.events = new EventEmitter();
    Promise.all([
        base.loadConfig().then(function(config) {
            options.config = config;

            config.botName && (config.botName = config.botName.toLowerCase());
        })
    ]).then(function() {
        options.locale = new Locale(options);
        return options.locale.onReady.then(function () {
            options.language = options.locale.language;
        });
    }).then(function() {
        options.db = new Db(options);
        return options.db.onReady;
    }).then(function() {
        options.users = new Users(options);
        return options.users.onReady;
    }).then(function() {
        options.msgStack = new MsgStack(options);
        return options.msgStack.onReady;
    }).then(function() {
        return Promise.all(options.serviceList.map(function(name) {
            var service = require('./services/' + name);
            service = options.services[name] = new service(options);
            return service.onReady;
        }));
    }).then(function() {
        options.daemon = new Daemon(options);
    }).then(function() {
        options.bot = new TelegramBot(options.config.token, {
            polling: true
        });
        options.bot.on('polling_error', function (err) {
            debug('pollingError', err);
        });
    }).then(function() {
        options.tracker = new Tracker(options);
    }).then(function() {
        options.msgSender = new MsgSender(options);
    }).then(function() {
        options.chat = new Chat(options);
    }).then(function() {
        options.checker = new Checker(options);
        options.pushApi = new PushApi(options);

        return options.pushApi.onReady;
    }).catch(function(err) {
        debug('Loading error', err);
    });
})();