import { useState, type ReactElement } from 'react';
import { useNavigate, useRevalidator } from 'react-router';

import { canManageMembers, isTableRole, TABLE_ROLES } from '@vtt/shared';
import type { MemberView } from '@vtt/shared/api';
import { Alert, Button, Select } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import type { TableData } from '../table/table-data.js';

/**
 * The table's members (FR-TABLE-04, 05): the GM changes roles and removes members; everyone
 * picks their own default character and may leave.
 */
export function MemberList({ data, userId }: { data: TableData; userId: string }): ReactElement {
  const { table, members, actors } = data;
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const manages = canManageMembers(table.role);
  const ownCharacters = actors.filter((actor) => actor.access === 'owner');

  const run = async (action: () => Promise<string>) => {
    setFailure(null);
    try {
      setStatus(await action());
      await revalidator.revalidate();
    } catch (caught) {
      setStatus(null);
      setFailure(errorMessage(caught));
    }
  };

  const leave = async () => {
    setFailure(null);
    try {
      await api.removeMember(table.id, userId);
      await navigate('/', { replace: true });
    } catch (caught) {
      setFailure(errorMessage(caught));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {failure && <Alert tone="error">{failure}</Alert>}
      {status && (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      )}
      <ul className="flex list-none flex-col gap-2 p-0" aria-label={t('members.title')}>
        {members.map((member: MemberView) => {
          const self = member.userId === userId;
          return (
            <li
              key={member.userId}
              className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <h3 className="truncate font-semibold">
                  {self ? t('members.you', { name: member.displayName }) : member.displayName}
                </h3>
                <p className="text-sm text-muted">@{member.username}</p>
              </div>
              {manages ? (
                <Select
                  label={t('members.role')}
                  value={member.role}
                  onChange={(e) => {
                    const role = e.target.value;
                    if (!isTableRole(role)) return;
                    void run(async () => {
                      await api.updateMember(table.id, member.userId, { role });
                      return t('members.roleChanged', {
                        name: member.displayName,
                        role: t(`tables.role.${role}`),
                      });
                    });
                  }}
                >
                  {TABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t(`tables.role.${role}`)}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="self-center text-sm">{t(`tables.role.${member.role}`)}</span>
              )}
              {self && ownCharacters.length > 0 && (
                <Select
                  label={t('members.defaultCharacter')}
                  value={member.defaultCharacterId ?? ''}
                  onChange={(e) => {
                    const defaultCharacterId = e.target.value || null;
                    void run(async () => {
                      await api.updateMember(table.id, userId, { defaultCharacterId });
                      return t('members.defaultCharacterSaved');
                    });
                  }}
                >
                  <option value="">{t('members.noDefaultCharacter')}</option>
                  {ownCharacters.map((actor) => (
                    <option key={actor.id} value={actor.id}>
                      {actor.name}
                    </option>
                  ))}
                </Select>
              )}
              {self ? (
                <Button onClick={() => void leave()}>{t('members.leave')}</Button>
              ) : (
                manages && (
                  <Button
                    onClick={() =>
                      void run(async () => {
                        await api.removeMember(table.id, member.userId);
                        return t('members.removed', { name: member.displayName });
                      })
                    }
                  >
                    {t('members.remove')}
                  </Button>
                )
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">{t('members.removeNote')}</p>
    </div>
  );
}
