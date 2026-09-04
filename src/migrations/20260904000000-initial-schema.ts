import type {Migration} from '../migrator';

interface BaselineTable {
  table: string;
  create: string;
  indexes: Array<{name: string; sql: string}>;
}

const tables: BaselineTable[] = [
  {
    table: 'chats',
    create:
      "CREATE TABLE IF NOT EXISTS `chats` (`id` VARCHAR(191) NOT NULL , `channelId` VARCHAR(191), `isHidePreview` TINYINT(1) DEFAULT false, `isMuted` TINYINT(1) DEFAULT false, `isSkipShortVideos` TINYINT(1) DEFAULT false, `sendTimeoutExpiresAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `parentChatId` VARCHAR(191), `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`id`), FOREIGN KEY (`channelId`) REFERENCES `chats` (`id`) ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY (`parentChatId`) REFERENCES `chats` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
    indexes: [
      {
        name: 'channelId_UNIQUE',
        sql: 'ALTER TABLE `chats` ADD UNIQUE INDEX `channelId_UNIQUE` (`channelId`)',
      },
      {
        name: 'sendTimeoutExpiresAt_idx',
        sql: 'ALTER TABLE `chats` ADD INDEX `sendTimeoutExpiresAt_idx` (`sendTimeoutExpiresAt`)',
      },
    ],
  },
  {
    table: 'channels',
    create:
      "CREATE TABLE IF NOT EXISTS `channels` (`id` VARCHAR(191) NOT NULL , `service` VARCHAR(191) NOT NULL, `title` TEXT, `url` TEXT NOT NULL, `hasChanges` TINYINT(1) NOT NULL DEFAULT false, `lastVideoPublishedAt` DATETIME DEFAULT NULL, `lastSyncAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `lastFullSyncAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `syncTimeoutExpiresAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `subscriptionExpiresAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `subscriptionTimeoutExpiresAt` DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00', `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
    indexes: [
      {
        name: 'hasChanges_idx',
        sql: 'ALTER TABLE `channels` ADD INDEX `hasChanges_idx` (`hasChanges`)',
      },
      {
        name: 'lastVideoPublishedAt_idx',
        sql: 'ALTER TABLE `channels` ADD INDEX `lastVideoPublishedAt_idx` (`lastVideoPublishedAt`)',
      },
      {
        name: 'lastSyncAt_idx',
        sql: 'ALTER TABLE `channels` ADD INDEX `lastSyncAt_idx` (`lastSyncAt`)',
      },
      {
        name: 'syncTimeoutExpiresAt_idx',
        sql: 'ALTER TABLE `channels` ADD INDEX `syncTimeoutExpiresAt_idx` (`syncTimeoutExpiresAt`)',
      },
      {
        name: 'subscriptionExpiresAt_subscriptionTimeoutExpiresAt_idx',
        sql: 'ALTER TABLE `channels` ADD INDEX `subscriptionExpiresAt_subscriptionTimeoutExpiresAt_idx` (`subscriptionExpiresAt`, `subscriptionTimeoutExpiresAt`)',
      },
    ],
  },
  {
    table: 'ytPubSubs',
    create:
      'CREATE TABLE IF NOT EXISTS `ytPubSubs` (`videoId` VARCHAR(191) NOT NULL , `channelId` VARCHAR(191) DEFAULT NULL, `publishedAt` DATETIME DEFAULT NULL, `lastPushAt` DATETIME NOT NULL, `createdAt` DATETIME NOT NULL, PRIMARY KEY (`videoId`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    indexes: [
      {
        name: 'lastPushAt_idx',
        sql: 'ALTER TABLE `ytPubSubs` ADD INDEX `lastPushAt_idx` (`lastPushAt`)',
      },
    ],
  },
  {
    table: 'chatIdChannelId',
    create:
      'CREATE TABLE IF NOT EXISTS `chatIdChannelId` (`id` INTEGER NOT NULL auto_increment , `chatId` VARCHAR(191) NOT NULL, `channelId` VARCHAR(191) NOT NULL, `createdAt` DATETIME NOT NULL, PRIMARY KEY (`id`), FOREIGN KEY (`chatId`) REFERENCES `chats` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`channelId`) REFERENCES `channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    indexes: [
      {
        name: 'chatId_channelId_UNIQUE',
        sql: 'ALTER TABLE `chatIdChannelId` ADD UNIQUE INDEX `chatId_channelId_UNIQUE` (`chatId`, `channelId`)',
      },
      {
        name: 'chatId_idx',
        sql: 'ALTER TABLE `chatIdChannelId` ADD INDEX `chatId_idx` (`chatId`)',
      },
      {
        name: 'channelId_idx',
        sql: 'ALTER TABLE `chatIdChannelId` ADD INDEX `channelId_idx` (`channelId`)',
      },
      {
        name: 'createdAt_idx',
        sql: 'ALTER TABLE `chatIdChannelId` ADD INDEX `createdAt_idx` (`createdAt`)',
      },
    ],
  },
  {
    table: 'videos',
    create:
      'CREATE TABLE IF NOT EXISTS `videos` (`id` VARCHAR(191) NOT NULL , `url` VARCHAR(191) NOT NULL, `title` VARCHAR(191) NOT NULL, `previews` TEXT NOT NULL, `duration` VARCHAR(191), `channelId` VARCHAR(191) NOT NULL, `publishedAt` DATETIME NOT NULL, `telegramPreviewFileId` TEXT, `mergedId` VARCHAR(191), `mergedChannelId` VARCHAR(191), `createdAt` DATETIME NOT NULL, PRIMARY KEY (`id`), FOREIGN KEY (`channelId`) REFERENCES `channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    indexes: [
      {
        name: 'publishedAt_idx',
        sql: 'ALTER TABLE `videos` ADD INDEX `publishedAt_idx` (`publishedAt`)',
      },
    ],
  },
  {
    table: 'chatIdVideoId',
    create:
      'CREATE TABLE IF NOT EXISTS `chatIdVideoId` (`id` INTEGER NOT NULL auto_increment , `chatId` VARCHAR(191) NOT NULL, `videoId` VARCHAR(191) NOT NULL, `createdAt` DATETIME NOT NULL, PRIMARY KEY (`id`), FOREIGN KEY (`chatId`) REFERENCES `chats` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`videoId`) REFERENCES `videos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    indexes: [
      {
        name: 'chatId_videoId_UNIQUE',
        sql: 'ALTER TABLE `chatIdVideoId` ADD UNIQUE INDEX `chatId_videoId_UNIQUE` (`chatId`, `videoId`)',
      },
      {
        name: 'chatId_idx',
        sql: 'ALTER TABLE `chatIdVideoId` ADD INDEX `chatId_idx` (`chatId`)',
      },
    ],
  },
];

export const up: Migration = async ({context}) => {
  for (const {table, create, indexes} of tables) {
    await context.sequelize.query(create);

    const indexesInDatabase = (await context.showIndex(table)) as Array<{name: string}>;
    const existingIndexes = new Set(indexesInDatabase.map(({name}) => name));
    for (const index of indexes) {
      if (!existingIndexes.has(index.name)) await context.sequelize.query(index.sql);
    }
  }
};
