import type { FastifyPluginCallback } from "fastify";

import { pagePool } from "../browser/pagepool";
import { parsePage } from "../parser/parser";

type Options = {
  texts: string[];
  from: string;
  to: string;
  lite: boolean;
};

const handler = async (request: any, reply: any) => {
  const options = {
    ...request.query,
    ...request.body,
  };
  const { texts, from = "auto", to = "zh-CN", lite = false } = options;

  if (!texts || !Array.isArray(texts) || texts.length === 0) {
    reply
      .code(400)
      .header("Content-Type", "application/json; charset=utf-8")
      .send({
        error: 1,
        message: "texts (array) is required",
      });
    return;
  }

  const page = pagePool.getPage();
  if (!page) {
    reply
      .code(503)
      .header("Content-Type", "application/json; charset=utf-8")
      .send({
        error: 1,
        message: "No resources available. Please try again later.",
      });
    return;
  }

  try {
    const startTime = Date.now();

    // Process all translations concurrently
    const translatedResults = await Promise.all(
      texts.map(async (text) => {
        try {
          const res = await parsePage(page, { text, from, to, lite });
          const response: any = {
            text: text,
            result: res.result,
            pronunciation: res.pronunciation,
            definitions: res.definitions,
            examples: res.examples,
            translations: res.translations,
          };

          // Clean undefined or empty fields
          Object.keys(response).forEach((key) => {
            if (
              response[key] === undefined ||
              (typeof response[key] === "object" &&
                Object.keys(response[key]).length === 0) ||
              (Array.isArray(response[key]) && response[key].length === 0)
            ) {
              delete response[key];
            }
          });

          return response;
        } catch (error) {
          // Handle errors for individual text
          console.error(`Error translating text: ${text}`, error);
          return { text, error: "Translation failed" };
        }
      })
    );

    const endTime = Date.now();
    console.log(`Translation completed in ${endTime - startTime}ms`);

    reply
      .code(200)
      .header("Content-Type", "application/json; charset=utf-8")
      .send({
        translatedTexts: translatedResults,
      });
  } catch (e) {
    console.error("Unexpected error in translation handler", e);
    reply
      .code(500)
      .header("Content-Type", "application/json; charset=utf-8")
      .send({
        error: 1,
        message: "An unexpected error occurred.",
      });
  } finally {
    pagePool.releasePage(page);
  }
};

export default ((fastify, opts, done) => {
  fastify.route<{
    Body: Options;
  }>({
    method: "POST",
    url: "/",
    schema: {
      body: {
        type: "object",
        properties: {
          texts: { type: "array", items: { type: "string" } },
          from: { type: "string" },
          to: { type: "string" },
          lite: { type: "boolean" },
        },
        required: ["texts"],
      },
    },
    handler,
  });

  done();
}) as FastifyPluginCallback;