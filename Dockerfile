FROM node:18-alpine as node
ENV NO_UPDATE_NOTIFIER true

FROM node as base
WORKDIR /opt
RUN chown -R nobody:nobody ./ && \
    mkdir /.npm && \
    chown -R nobody:nobody /.npm
USER nobody:nobody
COPY ./package.json .
COPY ./package-lock.json .
RUN npm ci --omit=dev

FROM base as build
WORKDIR /opt
USER nobody:nobody
RUN npm ci
ADD ./src ./src
COPY ./tsconfig.json .
RUN npm run build

FROM base as release
WORKDIR /opt
COPY --from=build /opt/dist ./dist
USER nobody:nobody
COPY ./liveTime.json .
COPY ./config.json .
ENV NODE_ENV=production
ENV DEBUG=app:*

EXPOSE 1337

CMD node ./dist/main.js 1>> ./log/stdout.log 2>> ./log/stderr.log
