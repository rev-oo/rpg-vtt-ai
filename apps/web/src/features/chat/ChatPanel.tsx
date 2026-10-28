import { useForm } from '@tanstack/react-form';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';

import {
  canDeleteMessage,
  canEditMessage,
  canSendChat,
  type Audience,
  type Subject,
} from '@vtt/shared';
import {
  MAX_CHAT_TEXT,
  type ActorView,
  type ChatMessage,
  type MemberView,
  type TableView,
} from '@vtt/shared/api';
import { Alert, Button, Select } from '@vtt/ui';

import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import { CardMessage } from '../../plugin-host/CardMessage.js';
import { useTableEvents } from '../../realtime/use-table-events.js';

import { parseChatInput } from './commands.js';
import { mergeMessages, replaceMessage, type ChatPage } from './messages.js';
import { RollView } from './RollView.js';

export interface ChatPanelProps {
  table: TableView;
  members: readonly MemberView[];
  userId: string;
  /** Actors the user may speak as (FR-CHAT-01). */
  speakers: readonly ActorView[];
  /** The newest history page, loaded with the route. */
  initialPage: ChatPage;
}

/** Distance from the top, in pixels, at which older messages start loading. */
const LOAD_OLDER_THRESHOLD = 48;

/**
 * Table chat (FR-CHAT-01, 02, 07, 08): history with infinite scroll, live messages from the
 * events socket, and a composer with speaker and audience selection.
 */
export function ChatPanel({
  table,
  members,
  userId,
  speakers,
  initialPage,
}: ChatPanelProps): ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    mergeMessages([], initialPage.messages),
  );
  /** `null` once the oldest message is shown. */
  const [olderCursor, setOlderCursor] = useState(initialPage.nextCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  /** Scroll height before older messages were prepended, to keep the view in place. */
  const heightBeforeOlder = useRef<number | null>(null);

  const add = useCallback((incoming: readonly ChatMessage[]) => {
    setMessages((current) => mergeMessages(current, incoming));
  }, []);

  const status = useTableEvents(table.id, {
    onEvent: (event) => {
      if (event.type === 'chat.message') add([event.payload.message]);
      if (event.type === 'chat.updated') {
        const edited = event.payload.message;
        setMessages((current) => replaceMessage(current, edited));
      }
      if (event.type === 'chat.deleted') {
        const { id } = event.payload;
        setMessages((current) => current.filter((m) => m.id !== id));
      }
    },
    // Messages sent while the socket was down come from history; older pages already shown
    // stay as they are.
    onResync: () => {
      api.chatHistory(table.id).then(
        (page) => {
          add(page.messages);
        },
        (e: unknown) => {
          setError(errorMessage(e));
        },
      );
    },
  });

  const loadOlder = async () => {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    heightBeforeOlder.current = listRef.current?.scrollHeight ?? null;
    try {
      const page = await api.chatHistory(table.id, olderCursor);
      add(page.messages);
      setOlderCursor(page.nextCursor);
    } catch (e) {
      heightBeforeOlder.current = null;
      setError(errorMessage(e));
    } finally {
      setLoadingOlder(false);
    }
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (heightBeforeOlder.current !== null) {
      list.scrollTop += list.scrollHeight - heightBeforeOlder.current;
      heightBeforeOlder.current = null;
    } else if (atBottom.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  // The composer grows (e.g. whisper recipients) and shrinks the log: stay on the newest message.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  }, []);

  const names = new Map(members.map((m) => [m.userId, m.displayName]));
  const me = members.find((m) => m.userId === userId);
  const subject: Subject | null = me ? { userId, role: me.role } : null;
  const now = useNow();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {status !== 'open' && (
        <span className="text-sm text-muted" role="status">
          {t(STATUS_MESSAGES[status])}
        </span>
      )}

      <div
        ref={listRef}
        role="log"
        aria-label={t('chat.messages')}
        className="min-h-24 flex-1 overflow-y-auto relative"
        onScroll={(e) => {
          const list = e.currentTarget;
          atBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
          if (list.scrollTop < LOAD_OLDER_THRESHOLD) void loadOlder();
        }}
      >
        {olderCursor && (
          <div className="flex justify-center py-1">
            <Button variant="ghost" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {t(loadingOlder ? 'app.loading' : 'chat.loadOlder')}
            </Button>
          </div>
        )}
        {messages.length === 0 && <p className="text-sm text-muted">{t('chat.empty')}</p>}
        <ol className="flex list-none flex-col gap-2 p-0">
          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              names={names}
              subject={subject}
              now={now}
              onEdited={(edited) => {
                setMessages((current) => replaceMessage(current, edited));
              }}
              onDeleted={(id) => {
                setMessages((current) => current.filter((m) => m.id !== id));
              }}
              onError={setError}
            />
          ))}
        </ol>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && (
        <p className="text-sm text-muted" role="status">
          {notice}
        </p>
      )}
      {table.archivedAt !== null ? (
        <p className="text-sm text-muted">{t('chat.archived')}</p>
      ) : me && canSendChat(me.role) ? (
        <Composer
          tableId={table.id}
          members={members}
          userId={userId}
          speakers={speakers}
          myName={me.displayName}
          onSent={(message) => {
            atBottom.current = true;
            setError(null);
            setNotice(null);
            add([message]);
          }}
          onNotice={setNotice}
          onError={setError}
        />
      ) : (
        <p className="text-sm text-muted">{t('chat.readOnly')}</p>
      )}
    </div>
  );
}

/** The time, moved on every 15 seconds so the edit and delete buttons go when their 5 minutes do. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 15_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

interface MessageItemProps {
  message: ChatMessage;
  names: ReadonlyMap<string, string>;
  /** The viewer, or `null` when they are not a member. */
  subject: Subject | null;
  now: number;
  onEdited: (message: ChatMessage) => void;
  onDeleted: (id: string) => void;
  onError: (error: string | null) => void;
}

function MessageItem({
  message,
  names,
  subject,
  now,
  onEdited,
  onDeleted,
  onError,
}: MessageItemProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const [busy, setBusy] = useState(false);
  const authorship = {
    senderId: message.senderId,
    kind: message.kind,
    sentAt: Date.parse(message.createdAt),
  };
  const mayEdit = subject !== null && canEditMessage(subject, authorship, now);
  const mayDelete = subject !== null && canDeleteMessage(subject, authorship, now);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onError(null);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      onEdited(await api.editChat(message.id, draft));
      setEditing(false);
    });
  const remove = () =>
    run(async () => {
      await api.deleteChat(message.id);
      onDeleted(message.id);
    });

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const recipients = message.recipientIds.map((id) => names.get(id) ?? t('chat.formerMember'));
  return (
    <li className="rounded-lg bg-canvas px-2 py-1">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-semibold">{message.speaker.name}</span>
        <time className="text-muted" dateTime={message.createdAt}>
          {time}
        </time>
        {message.audience === 'whisper' && (
          <span className="rounded-full bg-info-soft px-2 text-xs">
            {t('chat.whisperTo', { names: recipients.join(', ') })}
          </span>
        )}
        {message.audience === 'gm' && (
          <span className="rounded-full bg-info-soft px-2 text-xs">{t('chat.gmOnly')}</span>
        )}
        {message.editedAt && <span className="text-xs text-muted">{t('chat.edited')}</span>}
        {(mayEdit || mayDelete) && !editing && (
          <span className="ml-auto flex gap-1">
            {confirming ? (
              <>
                <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
                  {t('chat.confirmDelete')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  {t('chat.cancel')}
                </Button>
              </>
            ) : (
              <>
                {mayEdit && (
                  <Button
                    variant="ghost"
                    aria-label={t('chat.editMessage')}
                    onClick={() => {
                      setDraft(message.text);
                      setEditing(true);
                    }}
                  >
                    {t('chat.edit')}
                  </Button>
                )}
                {mayDelete && (
                  <Button
                    variant="ghost"
                    aria-label={t('chat.deleteMessage')}
                    onClick={() => {
                      setConfirming(true);
                    }}
                  >
                    {t('chat.delete')}
                  </Button>
                )}
              </>
            )}
          </span>
        )}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <textarea
            aria-label={t('chat.editMessage')}
            className="rounded-lg border border-line bg-surface p-1"
            value={draft}
            maxLength={MAX_CHAT_TEXT}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
          />
          <span className="flex gap-1">
            <Button type="submit" disabled={busy || draft.trim() === ''}>
              {t('chat.save')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
              }}
            >
              {t('chat.cancel')}
            </Button>
          </span>
        </form>
      ) : message.kind === 'card' ? (
        <CardMessage message={message} />
      ) : message.kind === 'roll' && message.rolls.length > 0 ? (
        <>
          {/* A typed roll's text is its formula, which the roll shows; plugin code may add more. */}
          {message.text !== '' && message.text !== message.rolls[0]?.expression && (
            <p className="break-words whitespace-pre-wrap">{message.text}</p>
          )}
          {message.rolls.map((roll, index) => (
            <RollView key={index} roll={roll} />
          ))}
        </>
      ) : (
        <p className="break-words whitespace-pre-wrap">{message.text}</p>
      )}
    </li>
  );
}

interface ComposerProps {
  tableId: string;
  members: readonly MemberView[];
  userId: string;
  speakers: readonly ActorView[];
  myName: string;
  onSent: (message: ChatMessage) => void;
  onNotice: (notice: string | null) => void;
  onError: (error: string | null) => void;
}

interface ComposerValues {
  text: string;
  /** An actor id, or `''` to speak as yourself. */
  speaker: string;
  audience: Audience;
  recipientIds: string[];
}

function Composer({
  tableId,
  members,
  userId,
  speakers,
  myName,
  onSent,
  onNotice,
  onError,
}: ComposerProps): ReactElement {
  const others = members.filter((m) => m.userId !== userId);
  const defaultValues: ComposerValues = {
    text: '',
    speaker: '',
    audience: 'public',
    recipientIds: [],
  };

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value, formApi }) => {
      const input = parseChatInput(value.text);
      switch (input.kind) {
        case 'empty':
          return;
        case 'roll':
        case 'command':
          break;
        case 'usage':
          onNotice(t('chat.rollUsage', { command: input.command }));
          return;
        case 'unknown':
          onNotice(t('chat.unknownCommand', { command: input.command }));
          return;
        case 'message':
          break;
      }
      // `/gmr` is always secret; `/r` goes to whoever the message would (FR-CHAT-05).
      const audience = input.kind === 'roll' && input.audience === 'gm' ? 'gm' : value.audience;
      if (audience === 'whisper' && value.recipientIds.length === 0) {
        onNotice(t('chat.chooseRecipients'));
        return;
      }
      const target = {
        audience,
        recipientIds: audience === 'whisper' ? value.recipientIds : [],
        actorId: value.speaker || null,
      };
      try {
        const message =
          input.kind === 'roll'
            ? await api.roll(tableId, { formula: input.formula, ...target })
            : input.kind === 'command'
              ? await api.command(tableId, { name: input.name, args: input.args, ...target })
              : await api.sendChat(tableId, { text: input.text, ...target });
        formApi.setFieldValue('text', '');
        onSent(message);
      } catch (e) {
        // A command the system lacks reads like a built-in one the chat does not know.
        if (e instanceof ApiError && e.code === 'unknown_command' && input.kind === 'command') {
          onNotice(t('chat.unknownCommand', { command: `/${input.name}` }));
          return;
        }
        onError(errorMessage(e));
      }
    },
  });

  const submitOnEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void form.handleSubmit();
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <form.Field name="speaker">
          {(field) => (
            <Select
              label={t('chat.speaker')}
              value={field.state.value}
              onChange={(e) => {
                field.handleChange(e.target.value);
              }}
            >
              <option value="">{t('chat.speakAsYourself', { name: myName })}</option>
              {speakers.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </Select>
          )}
        </form.Field>
        <form.Field name="audience">
          {(field) => (
            <Select
              label={t('chat.audience')}
              value={field.state.value}
              onChange={(e) => {
                const audience = AUDIENCE_OPTIONS.find((a) => a === e.target.value);
                if (audience) field.handleChange(audience);
              }}
            >
              {AUDIENCE_OPTIONS.map((audience) => (
                <option key={audience} value={audience}>
                  {t(`chat.audience.${audience}`)}
                </option>
              ))}
            </Select>
          )}
        </form.Field>
      </div>

      <form.Subscribe selector={(state) => state.values.audience}>
        {(audience) =>
          audience === 'whisper' && (
            <form.Field name="recipientIds">
              {(field) => (
                <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <legend className="font-semibold">{t('chat.recipients')}</legend>
                  {others.length === 0 && <span className="text-muted">{t('chat.noOthers')}</span>}
                  {others.map((member) => (
                    <label key={member.userId} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={field.state.value.includes(member.userId)}
                        onChange={(e) => {
                          const rest = field.state.value.filter((id) => id !== member.userId);
                          field.handleChange(e.target.checked ? [...rest, member.userId] : rest);
                        }}
                      />
                      {member.displayName}
                    </label>
                  ))}
                </fieldset>
              )}
            </form.Field>
          )
        }
      </form.Subscribe>

      <form.Field name="text">
        {(field) => (
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor={`chat-input-${tableId}`}>
              {t('chat.input')}
            </label>
            <textarea
              id={`chat-input-${tableId}`}
              rows={2}
              placeholder={t('chat.placeholder')}
              className="min-h-10 min-w-0 flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-fg"
              value={field.state.value}
              onChange={(e) => {
                field.handleChange(e.target.value);
              }}
              onKeyDown={submitOnEnter}
            />
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(submitting) => (
                <Button type="submit" variant="primary" disabled={submitting}>
                  {t('chat.send')}
                </Button>
              )}
            </form.Subscribe>
          </div>
        )}
      </form.Field>
    </form>
  );
}

const STATUS_MESSAGES = {
  connecting: 'chat.connecting',
  reconnecting: 'chat.reconnecting',
  ended: 'chat.sessionEnded',
} as const;

const AUDIENCE_OPTIONS = ['public', 'whisper', 'gm'] as const satisfies readonly Audience[];
