const debug = require('debug')('app:users');
const debugLog = require('debug')('app:users:log');
debugLog.log = console.log.bind(console);
const ErrorWithCode = require('./tools/errorWithCode');

class Users {
  constructor(/**Main*/main) {
    this.main = main;
    this.deSerializeChatRow = dbChatToChat;
  }

  init() {
    /*var _this = this;
    var db = this.main.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
      return new Promise(function (resolve, reject) {
        db.connection.query('\
              CREATE TABLE IF NOT EXISTS `chats` ( \
                  `id` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                  `channelId` VARCHAR(191) CHARACTER SET utf8mb4 NULL, \
                  `options` TEXT CHARACTER SET utf8mb4 NOT NULL, \
                  `insertTime` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \
              UNIQUE INDEX `id_UNIQUE` (`id` ASC), \
              UNIQUE INDEX `channelId_UNIQUE` (`channelId` ASC)); \
          ', function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
    promise = promise.then(function () {
      return new Promise(function (resolve, reject) {
        db.connection.query('\
              CREATE TABLE IF NOT EXISTS `chatIdChannelId` ( \
                  `chatId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                  `channelId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                  `insertTime` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \
              INDEX `chatId_idx` (`chatId` ASC), \
              UNIQUE INDEX `chatIdChannelId_UNIQUE` (`chatId` ASC, `channelId` ASC), \
              FOREIGN KEY (`chatId`) \
                  REFERENCES `chats` (`id`) \
                  ON DELETE CASCADE \
                  ON UPDATE CASCADE, \
              FOREIGN KEY (`channelId`) \
                  REFERENCES `channels` (`id`) \
                  ON DELETE CASCADE \
                  ON UPDATE CASCADE); \
          ', function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
    return promise;*/
  }

  /**
   * @param {string} id
   * @return {Promise.<Chat|null>}
   */
  getChat(id) {
    return this.main.db.models.Chats.findByPk(id).then((chat) => {
      if (!chat) {
        throw new ErrorWithCode('Chat is not found', 'CHAT_IS_NOT_FOUND');
      }
      return chat.get({plain: true});
    }).then((chat) => {
      return dbChatToChat(chat);
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            SELECT * FROM chats WHERE id = ? LIMIT 1; \
        ', [id], function (err, results) {
      if (err) {
        return reject(err);
      }

      resolve(dbChatToChat(results[0]));
    });
  });*/
  }

  /**
   * @param {Chat} chat
   * @return {Promise}
   */
  setChat(chat) {
    const item = {
      id: chat.id,
      channelId: chat.channelId,
      options: JSON.stringify(chat.options || {})
    };
    return this.main.db.models.Chats.upsert(item);
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            INSERT INTO chats SET ? ON DUPLICATE KEY UPDATE ?; \
        ', [item, item], function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results[0]);
      }
    });
  });*/
  }

  getChatByChannelId(channelId) {
    return this.main.db.models.Chats.findOne({
      where: {channelId}
    }).then((chat) => {
      if (!chat) {
        throw new ErrorWithCode('Chat is not found', 'CHAT_IS_NOT_FOUND');
      }
      return chat.get({plain: true});
    }).then((chat) => {
      return dbChatToChat(chat);
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            SELECT * FROM chats WHERE channelId = ? LIMIT 1; \
        ', [channelId], function (err, results) {
      if (err) {
        return reject(err);
      }

      resolve(dbChatToChat(results[0]));
    });
  });*/
  }

  /**
   * @param {string} id
   * @param {string} newId
   * @return {Promise}
   */
  changeChatId(id, newId) {
    return this.main.db.models.Chats.update({id: newId}, {
      where: {id}
    }).then(() => {
      debugLog('[migrate] %s > %s', id, newId);
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            UPDATE chats SET id = ? WHERE id = ?; \
        ', [newId, id], function (err) {
      if (err) {
        reject(err);
      } else {
        debugLog('[migrate] %s > %s', id, newId);
        resolve();
      }
    });
  });*/
  }

  /**
   * @param {string} id
   * @param {string} reason
   * @return {Promise}
   */
  removeChat(id, reason) {
    return this.main.db.models.Chats.destroy({
      where: {id}
    }).then(() => {
      debugLog('[remove] %s %j', id, reason);
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            DELETE FROM chats WHERE id = ?; \
        ', [id], function (err) {
      if (err) {
        reject(err);
      } else {
        debugLog('[remove] %s %j', id, reason);
        resolve();
      }
    });
  });*/
  }

  /**
   * @param {string} chatId
   * @param {string} channelId
   * @param {string} reason
   * @return {Promise}
   */
  removeChatChannel(chatId, channelId, reason) {
    return this.main.db.models.Chats.update({channelId}, {
      where: {id: chatId}
    }).then(() => {
      debugLog('[remove] %s %s %j', chatId, channelId, reason);
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            UPDATE chats SET channelId = ? WHERE id = ?; \
        ', [null, chatId], function (err) {
      if (err) {
        reject(err);
      } else {
        debugLog('[remove] %s %s %j', chatId, channelId, reason);
        resolve();
      }
    });
  });*/
  }

  /**
   * @param {string} chatId
   * @return {Promise.<dbChannel[]>}
   */
  getChannels(chatId) {
    return this.main.db.models.ChatIdChannelId.findAll({
      include: {model: this.main.db.models.Channels},
      where: {chatId},
      order: ['insertTime']
    }).then((channels) => {
      return channels.map(channel => channel.get({plain: true}).channel);
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            SELECT channels.* \
            FROM chatIdChannelId \
            LEFT JOIN channels ON channelId = channels.id \
            WHERE chatId = ? ORDER BY insertTime ASC; \
        ', [chatId], function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });*/
  }

  /**
   * @param {string} chatId
   * @param {string} channelId
   * @return {Promise.<dbChannel|undefined>}
   */
  getChannel(chatId, channelId) {
    return this.main.db.models.ChatIdChannelId.findOne({
      include: [
        {model: this.main.db.models.Channels}
      ],
      where: {chatId, channelId}
    }).then((result) => {
      if (!result) {
        throw new ErrorWithCode('Channel is not found', 'CHANNEL_NOT_FOUND');
      }
      return result.get({plain: true}).channel;
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            SELECT channels.* \
            FROM chatIdChannelId \
            LEFT JOIN channels ON channelId = channels.id \
            WHERE chatId = ? AND channelId = ? LIMIT 1; \
        ', [chatId, channelId], function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results[0]);
      }
    });
  });*/
  }

  /**
   * @param {string} chatId
   * @param {string} channelId
   * @return {Promise}
   */
  addChannel(chatId, channelId) {
    var item = {
      chatId: chatId,
      channelId: channelId
    };
    return this.main.db.models.ChatIdChannelId.upsert(item);
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            INSERT INTO chatIdChannelId SET ? ON DUPLICATE KEY UPDATE ?; \
        ', [item, item], function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });*/
  }

  /**
   * @param {string} chatId
   * @param {string} channelId
   * @return {Promise}
   */
  removeChannel(chatId, channelId) {
    return this.main.db.models.ChatIdChannelId.destroy({
      where: {chatId, channelId}
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            DELETE FROM chatIdChannelId WHERE chatId = ? AND channelId = ?; \
        ', [chatId, channelId], function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });*/
  }

  /**
   * @return {Promise}
   */
  getAllChatChannels() {
    return this.main.db.models.ChatIdChannelId.findAll({
      include: [
        {model: this.main.db.models.Channels}
      ],
      attributes: ['chatId']
    }).then((results) => {
      return results.map(result => result.get({plain: true}).channel);
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            SELECT chatId, channels.* \
            FROM chatIdChannelId \
            LEFT JOIN channels ON channelId = channels.id; \
        ', function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });*/
  }

  /**
   * @return {Promise}
   */
  getAllChannels() {
    return this.main.db.models.ChatIdChannelId.findAll({
      include: [
        {model: this.main.db.models.Channels}
      ],
      distinct: true
    }).then((results) => {
      return results.map(result => result.get({plain: true}));
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            SELECT DISTINCT channels.* \
            FROM channels \
            INNER JOIN chatIdChannelId ON chatIdChannelId.channelId = channels.id; \
        ', function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });*/
  }

  /**
   * @param {string} channelId
   * @return {Promise}
   */
  getChatIdsByChannel(channelId) {
    return this.main.db.models.ChatIdChannelId.findAll({
      where: {channelId},
      attributes: ['chatId']
    }).then((results) => {
      return results.map(result => result.chatId);
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            SELECT chatId FROM chatIdChannelId WHERE channelId = ?; \
        ', [channelId], function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results.map(function (item) {
          return item.chatId;
        }));
      }
    });
  });*/
  }

  /**
   * @return {Promise}
   */
  getAllChatIds() {
    return this.main.db.models.Chats.findAll({
      attributes: ['id']
    }).then((results) => {
      return results.map(result => result.id);
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            SELECT id FROM chats; \
        ', function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results.map(function (item) {
          return item.id;
        }));
      }
    });
  });*/
  }
}

/**
 * @typedef {{}} Chat
 * @property {string} id
 * @property {string|null} [channelId]
 * @property {{}} [options]
 * @property {boolean} [options.mute]
 * @property {boolean} [options.hidePreview]
 */

/**
 * @param {{}} dbChat
 * @return {Chat|null}
 */
function dbChatToChat(dbChat) {
  if (!dbChat.options) {
    dbChat.options = {};
  } else {
    dbChat.options = JSON.parse(dbChat.options);
  }
  return dbChat;
}

module.exports = Users;