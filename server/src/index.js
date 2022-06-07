const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const morgan = require("morgan");

const { fileURLToPath } = require("url");

const helmet = require("helmet");
const xss = require("xss-clean");
const mongoSanitize = require("express-mongo-sanitize");

const { createServer } = require("http");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { dirname } = require("path");
const { PrismaClient } = require("@prisma/client");

const { ApolloServer } = require("apollo-server-express");
const {
  ApolloServerPluginLandingPageGraphQLPlayground,
  ApolloServerPluginDrainHttpServer,
} = require("apollo-server-core");
const { PubSub } = require("graphql-subscriptions");

const { makeExecutableSchema } = require("@graphql-tools/schema");
const { SubscriptionServer } = require("subscriptions-transport-ws");
const { execute, subscribe } = require("graphql");

const { getUserId } = require("./utils");
const Query = require("./resolvers/Query");
const Mutation = require("./resolvers/Mutation");
const User = require("./resolvers/User");
const Link = require("./resolvers/Link");
const Vote = require("./resolvers/Vote");
const Subscription = require("./resolvers/Subscription");

const prisma = new PrismaClient();
const pubsub = new PubSub();

const PORT = 4000;
const resolvers = {
  Query,
  Mutation,
  Subscription,
  User,
  Link,
  Vote,
};
const typeDefs = fs.readFileSync(
  path.join(__dirname, "schema.graphql"),
  "utf8"
);
const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

async function startApolloServer() {
  const app = express();
  app.use(cors());
  if (process.env.NODE_ENV !== "production") {
    app.use(morgan("dev"));
  }
  //const __dirname = dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.resolve(__dirname, "./client/build")));
  //app.use(express.json());
  app.use(helmet());
  app.use(xss());
  app.use(mongoSanitize());
  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname, "./client/build", "index.html"));
  });
  const httpServer = createServer(app);

  const server = new ApolloServer({
    schema: schema,
    csrfPrevention: true,
    introspection: true,
    context: ({ req }) => {
      return {
        ...req,
        prisma,
        pubsub,
        userId: req && req.headers.authorization ? getUserId(req) : null,
      };
    },
    plugins: [
      ApolloServerPluginLandingPageGraphQLPlayground(),
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await subscriptionServer.close();
            },
          };
        },
      },
    ],
  });
  const subscriptionServer = SubscriptionServer.create(
    {
      schema,
      execute,
      subscribe,
      async onConnect(connectionParams, webSocket, context) {
        if (connectionParams.authToken) {
          return {
            prisma,
            userId: getUserId(null, connectionParams.authToken),
          };
        } else {
          return {
            prisma,
          };
        }
      },
      //   return {
      //     ...context.req,
      //     prisma,
      //     pubsub,
      //     userId:
      //       context.req && context.req.headers.authorization
      //         ? getUserId(context.req)
      //         : null,
      //   };
      // },
    },
    {
      server: httpServer,
      path: server.graphqlPath,
    }
  );

  await server.start();
  server.applyMiddleware({
    app,
    path: "/graphql",
  });

  httpServer.listen(PORT, () => {
    console.log(
      `🚀 Query endpoint ready at http://localhost:${PORT}${server.graphqlPath}`
    );
    console.log(
      `🚀 Subscription endpoint ready at ws://localhost:${PORT}${subscriptionServer.wsServer.options.path}`
    );
  });
}

startApolloServer();
