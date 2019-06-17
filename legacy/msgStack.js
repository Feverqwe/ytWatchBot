const base = require('./base');
const debug = require('debug')('app:msgStack');
const debugLog = require('debug')('app:msgStack:log');
debugLog.log = console.log.bind(console);

class MsgStack {
  constructor(/**Main*/main) {
    this.main = main;
    var _this = this;
    this.config = {};

    main.events.on('checkStack', function () {
      _this.checkStack();
    });
  }

  init() {
    /*var db = this.main.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS `messages` ( \
                `id` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `channelId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `publishedAt` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `data` LONGTEXT CHARACTER SET utf8mb4 NOT NULL, \
                `imageFileId` TEXT CHARACTER SET utf8mb4 NULL, \
            INDEX `publishedAt_idx` (`publishedAt` ASC), \
            UNIQUE INDEX `id_UNIQUE` (`id` ASC), \
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
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
                CREATE TABLE IF NOT EXISTS `chatIdMessageId` ( \
                    `chatId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `messageId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `timeout` INT NULL DEFAULT 0, \
                UNIQUE INDEX `chatIdMessageId_UNIQUE` (`chatId` ASC, `messageId` ASC), \
                FOREIGN KEY (`chatId`) \
                    REFERENCES `chats` (`id`) \
                    ON DELETE CASCADE \
                    ON UPDATE CASCADE,\
                FOREIGN KEY (`messageId`) \
                    REFERENCES `messages` (`id`) \
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

  async addChatIdsMessageId(transaction, chatIds, messageId) {
    if (!chatIds.length) {
      return;
    }

    const values = chatIds.map(function (chatId) {
      return {chatId, messageId};
    });

    return this.main.db.models.ChatIdMessageId.bulkCreate(values, {
      updateOnDuplicate: ['chatId'],
      transaction: transaction
    });

    /*return new Promise(function (resolve, reject) {
      if (!chatIds.length) {
        return resolve();
      }
      var values = chatIds.map(function (id) {
        return [id, messageId];
      });
      connection.query('\
              INSERT INTO chatIdMessageId (chatId, messageId) VALUES ? ON DUPLICATE KEY UPDATE chatId = chatId; \
          ', [values], function (err, results) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });*/
  }

  /**
   * @return {Promise.<StackItem[]>}
   */
  getStackItems() {
    const Sequelize = require('sequelize');
    return this.main.db.models.ChatIdMessageId.findAll({
      include: [
        {model: this.main.db.models.Messages},
        {model: this.main.db.models.Chats},
      ],
      where: {
        timeout: {[Sequelize.Op.lt]: base.getNow()}
      },
      order: [this.main.db.models.Messages.publishedAt],
      limit: 30
    }).then((results) => {
      return results.map(result => result.get({plain: true}));
    }).then((results) => {
      return results.map(function (result) {
        const {chat, message, ...chatIdMessageId} = result;
        return {
          chats: this.main.users.deSerializeChatRow(chat),
          messages: message,
          chatIdMessageId: chatIdMessageId,
        };
      })
    });

    /*const self = this;
  var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            SELECT \
            ' + db.wrapTableParams('chatIdMessageId', ['chatId', 'messageId', 'timeout']) + ', \
            ' + db.wrapTableParams('messages', ['id', 'channelId', 'publishedAt', 'data', 'imageFileId']) + ', \
            ' + db.wrapTableParams('chats', ['id', 'channelId', 'options', 'insertTime']) + ' \
            \ FROM chatIdMessageId \
            INNER JOIN messages ON chatIdMessageId.messageId = messages.id \
            INNER JOIN chats ON chatIdMessageId.chatId = chats.id \
            WHERE chatIdMessageId.timeout < ? \
            ORDER BY messages.publishedAt ASC \
            LIMIT 30; \
        ', [base.getNow()], function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results.map(function (row) {
          const item = db.unWrapTableParams(row);
          item.chats = self.main.users.deSerializeChatRow(item.chats);
          return item;
        }));
      }
    });
  });*/
  }

  /**
   * @typedef {{}} StackItem
   * @property {DbChatIdMessageId} chatIdMessageId
   * @property {DbMessage} messages
   * @property {Chat} chats
   */
  sendLog(chatId, messageId, isPhoto) {
    debugLog('[send] %s %s %s', isPhoto ? '(p)' : '(t)', messageId, chatId);
  }

  /**
   * @typedef {{}} StackItemData
   * @property {string} url
   * @property {string} title
   * @property {string[]} preview
   * @property {string} duration
   * @property {{}} channel
   * @property {string} channel.title
   * @property {id} channel.id
   */
  setTimeout(chatId, messageId, timeout) {
    return this.main.db.models.ChatIdMessageId.update({timeout}, {
      where: {chatId, messageId}
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            UPDATE chatIdMessageId SET timeout = ? WHERE chatId = ? AND messageId = ?; \
        ', [timeout, chatId, messageId], function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });*/
  }

  /**
   * @typedef {{}} DbMessage
   * @property {string} is
   * @property {string} channelId
   * @property {string} publishedAt
   * @property {string} data
   * @property {string|null} imageFileId
   */
  messageIdsExists(ids) {
    return this.main.db.models.Messages.findAll({
      where: {id: ids}
    }).then((messages) => {
      return messages.map(message => message.id);
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    if (!ids.length) {
      return resolve([]);
    }
    db.connection.query('\
            SELECT id FROM messages WHERE id IN ?; \
            ', [[ids]], function (err, results) {
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

  /**
   * @typedef {{}} DbChatIdMessageId
   * @property {string} chatId
   * @property {string} messageId
   * @property {number} timeout
   */
  setImageFileId(messageId, imageFileId) {
    return this.main.db.models.Messages.update({imageFileId}, {
      where: {id: messageId}
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            UPDATE messages SET imageFileId = ? WHERE id = ?; \
        ', [imageFileId, messageId], function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  }).catch(function (err) {
    debug('setImageFileId error %o', err);
  });*/
  }

  removeItem(chatId, messageId) {
    return this.main.db.models.ChatIdMessageId.destroy({
      where: {chatId, messageId}
    });
    /*var db = this.main.db;
  return new Promise(function (resolve, reject) {
    db.connection.query('\
            DELETE FROM chatIdMessageId WHERE chatId = ? AND messageId = ?; \
        ', [chatId, messageId], function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });*/
  }

  onSendMessageError(err) {
    var _this = this;
    /**
     * @type {Object}
     * @property {string} type
     * @property {string} id
     * @property {string} chatId
     */
    var itemObj = err.itemObj;
    var result = null;
    if (err.code === 'ETELEGRAM') {
      var body = err.response.body;

      var isBlocked = body.error_code === 403;
      if (!isBlocked) {
        isBlocked = [
          /group chat is deactivated/,
          /chat not found/,
          /channel not found/,
          /USER_DEACTIVATED/,
          /not enough rights to send photos to the chat/,
          /have no rights to send a message/,
          /need administrator rights in the channel chat/,
          /CHAT_WRITE_FORBIDDEN/,
          /CHAT_SEND_MEDIA_FORBIDDEN/
        ].some(function (re) {
          return re.test(body.description);
        });
      }

      if (isBlocked) {
        if (itemObj.type === 'chat') {
          result = _this.main.users.removeChat(itemObj.chatId, body.description);
        } else {
          result = _this.main.users.removeChatChannel(itemObj.chatId, itemObj.id, body.description).then(function () {
            const text = 'Channel ' + itemObj.id + ' removed. Reason: ' + body.description;
            return _this.main.bot.sendMessage(itemObj.chatId, text).catch(function (err) {
              debug('Send message about channel error! %s %s %o', itemObj.chatId, itemObj.id, err);
            });
          });
        }
      } else if (itemObj.type === 'chat' && body.parameters && body.parameters.migrate_to_chat_id) {
        result = _this.main.users.changeChatId(itemObj.chatId, body.parameters.migrate_to_chat_id);
      }
    }

    if (!result) {
      throw err;
    }

    return result;
  }

  sendVideoMessage(chat_id, messageId, message, data, useCache, chatId) {
    var _this = this;
    return _this.main.msgSender.sendMessage(chat_id, messageId, message, data, useCache).then(function (msg) {
      var isPhoto = !!msg.photo;

      _this.main.tracker.track(chat_id, 'bot', isPhoto ? 'sendPhoto' : 'sendMsg', data.channel.id);

      _this.sendLog(chat_id, messageId, isPhoto);
    });
  }

  sendItem(/*StackItem*/item) {
    var _this = this;
    var chatId = item.chats.id;
    var messageId = item.chatIdMessageId.messageId;
    var imageFileId = item.messages.imageFileId;

    var timeout = 5 * 60;
    return _this.setTimeout(chatId, messageId, base.getNow() + timeout).then(function () {
      /**
       * @type {StackItemData}
       */
      var data = JSON.parse(item.messages.data);

      const chat = item.chats;
      var options = chat.options;

      var text = base.getNowStreamText(_this.main, data);
      var caption = '';

      if (!options.hidePreview) {
        caption = base.getNowStreamPhotoText(_this.main, data);
      }

      var message = {
        imageFileId: imageFileId,
        caption: caption,
        text: text
      };

      var chatList = [{
        type: 'chat',
        id: chat.id,
        chatId: chat.id
      }];
      if (chat.channelId) {
        chatList.push({
          type: 'channel',
          id: chat.channelId,
          chatId: chat.id
        });
        if (options.mute) {
          chatList.shift();
        }
      }

      var promise = Promise.resolve();
      chatList.forEach(function (itemObj) {
        var chat_id = itemObj.id;
        promise = promise.then(function () {
          return _this.sendVideoMessage(chat_id, messageId, message, data, true, chat.id);
        }).catch(function (err) {
          err.itemObj = itemObj;
          throw err;
        });
      });

      return promise.catch(function (err) {
        return _this.onSendMessageError(err);
      });
    }).then(function () {
      return _this.removeItem(chatId, messageId);
    }).catch(function (err) {
      debug('sendItem %s %s %o', chatId, messageId, err);

      if (/PEER_ID_INVALID/.test(err)) {
        timeout = 6 * 60 * 60;
      }
      return _this.setTimeout(chatId, messageId, base.getNow() + timeout);
    });
  }

  checkStack() {
    var _this = this;
    var limit = 10;
    if (activePromises.length >= limit) return;

    _this.getStackItems().then(function (/*StackItem[]*/items) {
      items.some(function (item) {
        var chatId = item.chats.id;

        if (activePromises.length >= limit) return true;
        if (activeChatIds.indexOf(chatId) !== -1) return;

        var promise = _this.sendItem(item);
        activeChatIds.push(chatId);
        activePromises.push(promise);

        var any = function () {
          base.removeItemFromArray(activeChatIds, chatId);
          base.removeItemFromArray(activePromises, promise);
          _this.checkStack();
        };

        promise.then(function (result) {
          any();
          return result;
        }, function (err) {
          any();
          throw err;
        });
      });
    });
  }
}

var activeChatIds = [];
var activePromises = [];

module.exports = MsgStack;