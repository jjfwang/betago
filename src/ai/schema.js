import Ajv from "ajv";

const ajv = new Ajv();

const ACTION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["place", "pass", "resign"] },
    x: { type: "integer", minimum: 0, maximum: 18 },
    y: { type: "integer", minimum: 0, maximum: 18 },
    rationale: { type: "string", maxLength: 240 },
  },
  required: ["action"],
  allOf: [
    {
      if: {
        properties: { action: { const: "place" } },
      },
      then: {
        required: ["x", "y"],
      },
    },
  ],
};

export const validateAIAction = ajv.compile(ACTION_SCHEMA);
