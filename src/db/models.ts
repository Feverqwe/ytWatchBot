import Sequelize from 'sequelize';
import type {
  CreationAttributes,
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  NonAttribute,
} from 'sequelize';

type WithDefinedProperty<Model, Key extends keyof Model> = Model & {
  [Property in Key]-?: Exclude<Model[Property], undefined>;
};

type WithPresentProperty<Model, Key extends keyof Model> = Model & {
  [Property in Key]-?: NonNullable<Model[Property]>;
};

export class ChatModel extends Sequelize.Model<
  InferAttributes<ChatModel>,
  InferCreationAttributes<ChatModel>
> {
  declare id: string;
  declare channelId: CreationOptional<string | null>;
  declare isHidePreview: CreationOptional<boolean>;
  declare isMuted: CreationOptional<boolean>;
  declare isSkipShortVideos: CreationOptional<boolean>;
  declare sendTimeoutExpiresAt: CreationOptional<Date>;
  declare parentChatId: CreationOptional<string | null>;

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare channel?: NonAttribute<ChatModel | null>;
}
export type NewChat = CreationAttributes<ChatModel>;
export type ChatModelWithOptionalChannel = WithDefinedProperty<ChatModel, 'channel'>;

export class ChannelModel extends Sequelize.Model<
  InferAttributes<ChannelModel>,
  InferCreationAttributes<ChannelModel>
> {
  declare id: string;
  declare service: string;
  declare title: string;
  declare url: string;
  declare hasChanges: CreationOptional<boolean>;
  declare lastVideoPublishedAt: CreationOptional<Date | null>;
  declare lastSyncAt: CreationOptional<Date>;
  declare lastFullSyncAt: CreationOptional<Date>;
  declare syncTimeoutExpiresAt: CreationOptional<Date>;
  declare subscriptionExpiresAt: CreationOptional<Date>;
  declare subscriptionTimeoutExpiresAt: CreationOptional<Date>;

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
export type NewChannel = CreationAttributes<ChannelModel>;

export class YtPubSubModel extends Sequelize.Model<
  InferAttributes<YtPubSubModel>,
  InferCreationAttributes<YtPubSubModel>
> {
  declare videoId: string;
  declare channelId: CreationOptional<string | null>;
  declare publishedAt: CreationOptional<Date | null>;
  declare lastPushAt: Date;

  declare createdAt: CreationOptional<Date>;
}

export class ChatIdChannelIdModel extends Sequelize.Model<
  InferAttributes<ChatIdChannelIdModel>,
  InferCreationAttributes<ChatIdChannelIdModel>
> {
  declare chatId: string;
  declare channelId: string;
  declare createdAt: CreationOptional<Date>;

  declare channel?: NonAttribute<ChannelModel>;
  declare chat?: NonAttribute<ChatModel>;
}
export type NewChatIdChannelIdModel = CreationAttributes<ChatIdChannelIdModel>;

export class VideoModel extends Sequelize.Model<
  InferAttributes<VideoModel>,
  InferCreationAttributes<VideoModel>
> {
  declare id: string;
  declare url: string;
  declare title: string;
  declare previews: string;
  declare duration: CreationOptional<string | null>;
  declare channelId: string;
  declare publishedAt: Date;
  declare telegramPreviewFileId: CreationOptional<string | null>;
  declare mergedId: CreationOptional<string | null>;
  declare mergedChannelId: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;

  declare channel?: NonAttribute<ChannelModel>;
}
export type VideoModelWithChannel = WithPresentProperty<VideoModel, 'channel'>;
export type NewVideo = CreationAttributes<VideoModel>;

export class ChatIdVideoIdModel extends Sequelize.Model<
  InferAttributes<ChatIdVideoIdModel>,
  InferCreationAttributes<ChatIdVideoIdModel>
> {
  declare id: CreationOptional<number>;
  declare chatId: string;
  declare videoId: string;
  declare createdAt: CreationOptional<Date>;

  declare video?: NonAttribute<VideoModel>;
}
export type NewChatIdVideoId = CreationAttributes<ChatIdVideoIdModel>;

export function initModels(sequelize: Sequelize.Sequelize) {
  ChatModel.init(
    {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: true},
      isHidePreview: {type: Sequelize.BOOLEAN, defaultValue: false},
      isMuted: {type: Sequelize.BOOLEAN, defaultValue: false},
      isSkipShortVideos: {type: Sequelize.BOOLEAN, defaultValue: false},
      sendTimeoutExpiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: '1970-01-01 00:00:00',
      },
      parentChatId: {type: Sequelize.STRING(191), allowNull: true},
      createdAt: {type: Sequelize.DATE, allowNull: false},
      updatedAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
      modelName: 'chat',
      tableName: 'chats',
      timestamps: true,
      indexes: [
        {
          name: 'channelId_UNIQUE',
          unique: true,
          fields: ['channelId'],
        },
        {
          name: 'sendTimeoutExpiresAt_idx',
          fields: ['sendTimeoutExpiresAt'],
        },
      ],
    },
  );
  ChatModel.belongsTo(ChatModel, {
    foreignKey: 'channelId',
    targetKey: 'id',
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'channel',
  });
  ChatModel.belongsTo(ChatModel, {
    foreignKey: 'parentChatId',
    targetKey: 'id',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'parentChat',
  });

  ChannelModel.init(
    {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      service: {type: Sequelize.STRING(191), allowNull: false},
      title: {type: Sequelize.TEXT, allowNull: true},
      url: {type: Sequelize.TEXT, allowNull: false},
      hasChanges: {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false},
      lastVideoPublishedAt: {type: Sequelize.DATE, allowNull: true, defaultValue: null},
      lastSyncAt: {type: Sequelize.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
      lastFullSyncAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: '1970-01-01 00:00:00',
      },
      syncTimeoutExpiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: '1970-01-01 00:00:00',
      },
      subscriptionExpiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: '1970-01-01 00:00:00',
      },
      subscriptionTimeoutExpiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: '1970-01-01 00:00:00',
      },
      createdAt: {type: Sequelize.DATE, allowNull: false},
      updatedAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
      modelName: 'channel',
      tableName: 'channels',
      timestamps: true,
      indexes: [
        {
          name: 'hasChanges_idx',
          fields: ['hasChanges'],
        },
        {
          name: 'lastVideoPublishedAt_idx',
          fields: ['lastVideoPublishedAt'],
        },
        {
          name: 'lastSyncAt_idx',
          fields: ['lastSyncAt'],
        },
        {
          name: 'syncTimeoutExpiresAt_idx',
          fields: ['syncTimeoutExpiresAt'],
        },
        {
          name: 'subscriptionExpiresAt_subscriptionTimeoutExpiresAt_idx',
          fields: ['subscriptionExpiresAt', 'subscriptionTimeoutExpiresAt'],
        },
      ],
    },
  );

  YtPubSubModel.init(
    {
      videoId: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      channelId: {type: Sequelize.STRING(191), allowNull: true, defaultValue: null},
      publishedAt: {type: Sequelize.DATE, allowNull: true, defaultValue: null},
      lastPushAt: {type: Sequelize.DATE, allowNull: false},
      createdAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
      modelName: 'ytPubSub',
      timestamps: true,
      updatedAt: false,
      indexes: [
        {
          name: 'lastPushAt_idx',
          fields: ['lastPushAt'],
        },
      ],
    },
  );

  ChatIdChannelIdModel.init(
    {
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      createdAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
      modelName: 'chatIdChannelId',
      tableName: 'chatIdChannelId',
      timestamps: true,
      updatedAt: false,
      indexes: [
        {
          name: 'chatId_channelId_UNIQUE',
          unique: true,
          fields: ['chatId', 'channelId'],
        },
        {
          name: 'channelId_idx',
          fields: ['channelId'],
        },
        {
          name: 'chatId_createdAt_idx',
          fields: ['chatId', 'createdAt'],
        },
      ],
    },
  );
  ChatIdChannelIdModel.belongsTo(ChatModel, {
    foreignKey: 'chatId',
    targetKey: 'id',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });
  ChatIdChannelIdModel.belongsTo(ChannelModel, {
    foreignKey: 'channelId',
    targetKey: 'id',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });

  VideoModel.init(
    {
      id: {type: Sequelize.STRING(191), allowNull: false, primaryKey: true},
      url: {type: Sequelize.STRING(191), allowNull: false},
      title: {type: Sequelize.STRING(191), allowNull: false},
      previews: {type: Sequelize.TEXT, allowNull: false},
      duration: {type: Sequelize.STRING(191), allowNull: true},
      channelId: {type: Sequelize.STRING(191), allowNull: false},
      publishedAt: {type: Sequelize.DATE, allowNull: false},
      telegramPreviewFileId: {type: Sequelize.TEXT, allowNull: true},
      mergedId: {type: Sequelize.STRING(191), allowNull: true},
      mergedChannelId: {type: Sequelize.STRING(191), allowNull: true},
      createdAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
      modelName: 'video',
      tableName: 'videos',
      timestamps: true,
      updatedAt: false,
      indexes: [
        {
          name: 'publishedAt_idx',
          fields: ['publishedAt'],
        },
      ],
    },
  );
  VideoModel.belongsTo(ChannelModel, {
    foreignKey: 'channelId',
    targetKey: 'id',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });

  ChatIdVideoIdModel.init(
    {
      id: {type: Sequelize.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true},
      chatId: {type: Sequelize.STRING(191), allowNull: false},
      videoId: {type: Sequelize.STRING(191), allowNull: false},
      createdAt: {type: Sequelize.DATE, allowNull: false},
    },
    {
      sequelize: sequelize,
      modelName: 'chatIdVideoId',
      tableName: 'chatIdVideoId',
      timestamps: true,
      updatedAt: false,
      indexes: [
        {
          name: 'chatId_videoId_UNIQUE',
          unique: true,
          fields: ['chatId', 'videoId'],
        },
      ],
    },
  );
  ChatIdVideoIdModel.belongsTo(ChatModel, {
    foreignKey: 'chatId',
    targetKey: 'id',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });
  ChatIdVideoIdModel.belongsTo(VideoModel, {
    foreignKey: 'videoId',
    targetKey: 'id',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });
  ChatModel.hasMany(ChatIdVideoIdModel, {
    sourceKey: 'id',
    foreignKey: 'chatId',
  });
}
