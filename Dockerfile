FROM node:16-alpine as node
ENV NO_UPDATE_NOTIFIER true
RUN npm i -g npm@^8

FROM node as base
WORKDIR /opt/backend
RUN chown -R nobody:nobody ./ && \
    mkdir /.npm && \
    chown -R nobody:nobody /.npm
USER nobody:nobody
COPY ./package.json .
COPY ./package-lock.json .
RUN npm ci --production

FROM base as build
WORKDIR /opt/backend
USER nobody:nobody
RUN npm ci
ADD ./src ./src
COPY ./rollup.config.js .
COPY ./tsconfig.json .
RUN npm run build

FROM base as release
WORKDIR /opt/backend
COPY --from=build /opt/backend/dist ./dist
USER nobody:nobody
COPY ./liveTime.json .
COPY ./config.json .
ENV NODE_ENV=production
ENV DEBUG=app:*

EXPOSE 1337

CMD node ./dist/main.js 1>> ./log/stdout.log 2>> ./log/stderr.log
