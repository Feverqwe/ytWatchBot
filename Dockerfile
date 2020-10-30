FROM node:12-alpine as node
ENV NO_UPDATE_NOTIFIER true

FROM node as base
WORKDIR /opt/ytWatchBot
RUN chown -R nobody:nobody ./ && \
    mkdir /.npm && \
    chown -R nobody:nobody /.npm
USER nobody:nobody
COPY ./package.json .
COPY ./package-lock.json .
RUN npm install --production

FROM base as build
WORKDIR /opt/ytWatchBot
USER nobody:nobody
RUN npm install
ADD ./src ./src
COPY ./rollup.config.js .
RUN npm run build

FROM base as release
WORKDIR /opt/ytWatchBot
COPY --from=build /opt/ytWatchBot/dist ./dist
USER nobody:nobody
COPY ./liveTime.json .
COPY ./config.json .
ENV NODE_ENV=production
ENV DEBUG=*,-node-telegram-bot-api,-sequelize:*,-express:*,-body-parser:*

EXPOSE 1337

CMD node ./dist/main.js 1>> ./log/stdout.log 2>> ./log/stderr.log