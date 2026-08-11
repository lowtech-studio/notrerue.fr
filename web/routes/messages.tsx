import { Head } from "fresh/runtime";
import "../assets/pages/messages.css" with { type: "css" };
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { getStreetHousesStatus } from "../db/streets.ts";
import { getPostSummary, type PostSummary } from "../db/posts.ts";
import {
  type ConversationSummary,
  getConversation,
  listConversations,
  MAX_MESSAGE_CONTENT_LENGTH,
  sendMessage,
  type ThreadMessage,
} from "../db/messages.ts";
import { findSessionUserById } from "../db/users.ts";
import { containsBlockedContent } from "../moderation/blocklist.ts";
import { formatRelativeDate } from "../utils/relative_date.ts";

/** Contexte affiché en tête de conversation quand elle démarre depuis une demande (cf. backlog « bouton via une demande »). */
interface PostContext {
  id: number;
  content: string;
}

type MessagesData =
  | { view: "inbox"; conversations: ConversationSummary[] }
  | {
    view: "thread";
    otherUserId: number;
    otherUserLogin: string;
    messages: ThreadMessage[];
    postContext: PostContext | null;
    composeError: string | null;
    composeContent: string;
  };

function parseId(raw: string | null): number | null {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Contexte de demande à afficher, seulement s'il existe encore, appartient
 * à la même rue et a pour auteur l'un des deux participants — l'interlocuteur
 * (bouton « Message privé » sur sa demande) ou le viewer lui-même (lien
 * envoyé depuis un tapeur de sa propre demande, cf. backlog « message privé
 * à un tapeur pour s'organiser ») — sinon on l'ignore silencieusement
 * plutôt que de planter (postId manipulable dans l'URL).
 */
async function resolvePostContext(
  postId: number | null,
  streetId: number,
  viewerId: number,
  otherUserId: number,
): Promise<PostContext | null> {
  if (!postId) return null;
  const summary: PostSummary | null = await getPostSummary(postId);
  if (!summary || summary.streetId !== streetId) return null;
  if (summary.authorId !== otherUserId && summary.authorId !== viewerId) {
    return null;
  }
  return { id: summary.id, content: summary.content };
}

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) return ctx.redirect("/");

    const otherUserId = parseId(ctx.url.searchParams.get("with"));
    if (!otherUserId || otherUserId === user.id) {
      const conversations = await listConversations(user.id);
      return { data: { view: "inbox", conversations } };
    }

    const otherUser = await findSessionUserById(otherUserId);
    if (!otherUser || otherUser.street.id !== user.street.id) {
      return ctx.redirect("/messages");
    }

    const postContext = await resolvePostContext(
      parseId(ctx.url.searchParams.get("postId")),
      user.street.id,
      user.id,
      otherUserId,
    );
    const messages = await getConversation(user.id, otherUserId);

    return {
      data: {
        view: "thread",
        otherUserId,
        otherUserLogin: otherUser.login,
        messages,
        postContext,
        composeError: null,
        composeContent: "",
      },
    };
  },

  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) return ctx.redirect("/");

    const form = await ctx.req.formData();
    const otherUserId = parseId(String(form.get("to") ?? ""));
    const content = String(form.get("content") ?? "").trim().slice(
      0,
      MAX_MESSAGE_CONTENT_LENGTH,
    );

    if (!otherUserId || otherUserId === user.id) {
      return ctx.redirect("/messages");
    }

    const otherUser = await findSessionUserById(otherUserId);
    if (!otherUser || otherUser.street.id !== user.street.id) {
      return ctx.redirect("/messages");
    }

    // Revalidé ici plutôt que de faire confiance au postId brut du
    // formulaire : un postId forgé (inexistant, d'une autre rue, sans
    // rapport avec les deux participants) provoquerait sinon une violation
    // de FK à l'insertion, ou serait stocké sans contrôle (cf. revue).
    const postContext = await resolvePostContext(
      parseId(String(form.get("postId") ?? "")),
      user.street.id,
      user.id,
      otherUserId,
    );

    if (content && !containsBlockedContent(content)) {
      await sendMessage({
        fromUserId: user.id,
        toUserId: otherUserId,
        postId: postContext?.id ?? null,
        content,
      });
      const redirectParams = new URLSearchParams({
        with: String(otherUserId),
      });
      // Conservé dans la redirection : sinon le bandeau « À propos de »
      // disparaît dès le premier message envoyé (cf. revue).
      if (postContext) redirectParams.set("postId", String(postContext.id));
      return ctx.redirect(`/messages?${redirectParams}`);
    }

    // Erreur : on réaffiche la conversation avec le message d'erreur et le
    // brouillon tapé, plutôt qu'une redirection — même logique que /fil.
    const error = !content
      ? "Écrivez votre message avant de l'envoyer."
      : "Merci de reformuler : ce message contient des termes non autorisés.";
    const messages = await getConversation(user.id, otherUserId);

    return {
      data: {
        view: "thread",
        otherUserId,
        otherUserLogin: otherUser.login,
        messages,
        postContext,
        composeError: error,
        composeContent: content,
      },
    };
  },
});

function conversationHref(otherUserId: number): string {
  return `/messages?with=${otherUserId}`;
}

export default define.page<typeof handler>(function Messages({ data, state }) {
  const messagesData = data as MessagesData;

  return (
    <>
      <Head>
        <title>Mes messages — NotreRue.fr</title>
      </Head>
      <Header user={state.user} isStreetAwake={state.isStreetAwake} />
      <main>
        <section class="container hero hero--single page-wide">
          {messagesData.view === "inbox"
            ? (
              <>
                <h1 class="hero__title">Mes messages</h1>
                <p class="hero__subtitle">
                  Vos conversations privées avec vos voisins, elles ne sont
                  visibles que de vous deux.
                </p>

                {messagesData.conversations.length === 0
                  ? (
                    <p class="empty-state">
                      Aucune conversation pour l'instant. Répondez à une demande
                      du fil avec le bouton « Message privé » pour en démarrer
                      une.
                    </p>
                  )
                  : (
                    <ul class="messages-list">
                      {messagesData.conversations.map((conversation) => (
                        <li key={conversation.otherUserId}>
                          <a
                            href={conversationHref(conversation.otherUserId)}
                            class="messages-list__item"
                          >
                            <span
                              class="messages-list__avatar"
                              aria-hidden="true"
                            >
                              {conversation.otherUserLogin.charAt(0)
                                .toUpperCase()}
                            </span>
                            <span class="messages-list__body">
                              <span class="messages-list__login">
                                {conversation.otherUserLogin}
                              </span>
                              <span class="messages-list__date">
                                {formatRelativeDate(
                                  conversation.lastMessageAt,
                                )}
                              </span>
                              <span class="messages-list__preview">
                                {conversation.lastMessageFromViewer
                                  ? "Vous : "
                                  : ""}
                                {conversation.lastMessage}
                              </span>
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
              </>
            )
            : (
              <>
                <p class="hero__eyebrow">
                  <a href="/messages">← Mes messages</a>
                </p>
                <h1 class="hero__title">{messagesData.otherUserLogin}</h1>

                {messagesData.postContext && (
                  <p class="message-thread__post-context">
                    À propos de : « {messagesData.postContext.content} »
                  </p>
                )}

                {messagesData.messages.length === 0
                  ? (
                    <p class="empty-state">
                      Aucun message échangé pour l'instant. Écrivez le premier
                      ci-dessous.
                    </p>
                  )
                  : (
                    <ul class="message-thread">
                      {messagesData.messages.map((item, index) => {
                        const previous = messagesData.messages[index - 1];
                        const grouped = previous !== undefined &&
                          previous.fromViewer === item.fromViewer;
                        return (
                          <li
                            key={item.id}
                            class={`message-thread__bubble ${
                              item.fromViewer
                                ? "message-thread__bubble--mine"
                                : "message-thread__bubble--theirs"
                            } ${
                              grouped ? "message-thread__bubble--grouped" : ""
                            }`}
                          >
                            <p class="message-thread__content">
                              {item.content}
                            </p>
                            <p class="message-thread__date">
                              {formatRelativeDate(item.createdAt)}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                {messagesData.composeError && (
                  <p class="form-error" role="alert">
                    {messagesData.composeError}
                  </p>
                )}

                <div class="message-compose">
                  <form method="POST" class="message-compose__form">
                    <input
                      type="hidden"
                      name="to"
                      value={messagesData.otherUserId}
                    />
                    {messagesData.postContext && (
                      <input
                        type="hidden"
                        name="postId"
                        value={messagesData.postContext.id}
                      />
                    )}
                    <textarea
                      name="content"
                      class="message-compose__input"
                      placeholder="Votre message..."
                      maxlength={MAX_MESSAGE_CONTENT_LENGTH}
                      required
                    >
                      {messagesData.composeContent}
                    </textarea>
                    <button
                      type="submit"
                      class="button message-compose__submit"
                    >
                      Envoyer
                    </button>
                  </form>
                </div>
              </>
            )}
        </section>
      </main>
    </>
  );
});
