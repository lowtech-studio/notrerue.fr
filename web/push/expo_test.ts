import { assertEquals } from "@std/assert";
import {
  buildMessageMessage,
  buildNewPostMessage,
  buildReplyMessage,
  buildTapMessage,
} from "./expo.ts";

Deno.test("buildNewPostMessage : forme du payload, libellé selon le type", () => {
  const message = buildNewPostMessage(
    "Camille",
    "propose",
    "Je prête ma tondeuse",
  );
  assertEquals(message.title, "Camille — Je propose");
  assertEquals(message.body, "Je prête ma tondeuse");
  assertEquals(message.data, { type: "post" });
});

Deno.test("buildNewPostMessage : contenu long → tronqué avec une ellipse", () => {
  const longContent = "a".repeat(150);
  const message = buildNewPostMessage("Camille", "cherche", longContent);
  assertEquals(message.body.length, 100);
  assertEquals(message.body.endsWith("…"), true);
});

Deno.test("buildTapMessage : forme du payload", () => {
  const message = buildTapMessage("Camille", "Je cherche une perceuse");
  assertEquals(message.title, "Camille a répondu à votre demande");
  assertEquals(message.body, "Je cherche une perceuse");
  assertEquals(message.data, { type: "tap" });
});

Deno.test("buildReplyMessage : forme du payload, avec le texte de la réponse (pas la demande)", () => {
  const message = buildReplyMessage(
    "Camille",
    "J'ai un bon plombier à vous recommander",
  );
  assertEquals(message.title, "Camille a répondu à votre demande");
  assertEquals(message.body, "J'ai un bon plombier à vous recommander");
  assertEquals(message.data, { type: "reply" });
});

Deno.test("buildMessageMessage : forme du payload, sans le contenu du message", () => {
  const message = buildMessageMessage("Camille");
  assertEquals(message.title, "Nouveau message de Camille");
  assertEquals(message.body, "Touchez pour lire le message.");
  assertEquals(message.data, { type: "message" });
});
