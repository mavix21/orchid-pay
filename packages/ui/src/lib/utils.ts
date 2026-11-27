import { createCn } from "cn/config";

export const cn = createCn({
  extend: {
    theme: {
      text: [
        "display",
        "h1",
        "h2",
        "body-lg",
        "body",
        "label-lg",
        "label",
        "label-sm",
        "caption",
      ],
      shadow: ["raised", "overlay"],
      font: ["display"],
    },
  },
});
