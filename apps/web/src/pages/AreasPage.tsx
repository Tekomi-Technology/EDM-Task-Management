import type { AreaView, Boundary } from '../types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Upload, Users } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { ActionMenu } from '../components/ActionMenu';
import { AreaMap, type LngLat } from '../components/AreaMap';
import { useCrumbs } from '../components/ui';
import { t } from '../i18n';

type Shape = { kind: 'drawn'; ring: LngLat[] } | { kind: 'file'; boundary: Boundary; fileName: string };

interface Editing {
  /** null: a new area. */
  id: string | null;
  name: string;
  shape: Shape;
}

/** The API's refusal in the person's words. */
function problem(err: unknown): string | null {
  if (!err) return null;
  if (!(err instanceof ApiRequestError)) return (err as Error).message;
  const { code, details } = err.error as { code: string; details?: { areas?: string[] } };
  if (code === 'AREAS_OVERLAP')
    return t('The boundary overlaps {0}.', { 0: details?.areas?.join(', ') ?? '' });
  if (code === 'BOUNDARY_INVALID')
    return t('The edges of the boundary cross. Move the corners so they do not.');
  if (code === 'AREA_HAS_TEAMS') return t('Move or delete the teams of this area first.');
  if (code === 'AREA_IN_USE') return t('Tickets or depots belong to this area, so it is kept for history.');
  if (code === 'TEAM_IN_USE')
    return t(
      'People, tickets or vans belong to this team, so it is kept. Move its people to another team instead.'
    );
  return t(err.message);
}

/** The outline of a GeoJSON file: a geometry, a Feature or a FeatureCollection (all its polygons together). */
export function boundaryFromGeoJson(text: string): Boundary {
  const json = JSON.parse(text) as Record<string, unknown>;
  const geometries: unknown[] =
    json.type === 'FeatureCollection'
      ? ((json.features as { geometry: unknown }[]) ?? []).map((f) => f.geometry)
      : json.type === 'Feature'
        ? [json.geometry]
        : [json];
  const polygons: LngLat[][][] = [];
  const flat = (ring: number[][]) => ring.map((p) => [p[0]!, p[1]!] as LngLat);
  for (const g of geometries as { type?: string; coordinates?: number[][][] | number[][][][] }[]) {
    if (g?.type === 'Polygon') polygons.push((g.coordinates as number[][][]).map(flat));
    if (g?.type === 'MultiPolygon')
      for (const p of g.coordinates as number[][][][]) polygons.push(p.map(flat));
  }
  if (!polygons.length) throw new Error(t('The file has no polygon.'));
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0]! }
    : { type: 'MultiPolygon', coordinates: polygons };
}

function TeamRow({
  team,
  areas,
  areaId,
  receivesNew,
  onError
}: {
  team: AreaView['teams'][number];
  areas: AreaView[];
  areaId: string;
  /** This team gets the new tickets of its area. */
  receivesNew: boolean;
  onError: (message: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'rename' | 'move' | 'delete' | null>(null);
  const [name, setName] = useState(team.name);
  const [target, setTarget] = useState('');
  const done = () => {
    onError(null);
    setMode(null);
    void queryClient.invalidateQueries({ queryKey: ['admin-areas'] });
    void queryClient.invalidateQueries({ queryKey: ['lookups'] });
  };
  const change = useMutation({
    mutationFn: (body: { name?: string; areaId?: string; receivesNew?: true }) =>
      api(`/admin/teams/${team.id}`, { method: 'PATCH', body }),
    onSuccess: done,
    onError: (e) => onError(problem(e))
  });
  const remove = useMutation({
    mutationFn: () => api(`/admin/teams/${team.id}`, { method: 'DELETE' }),
    onSuccess: done,
    onError: (e) => onError(problem(e))
  });
  const others = areas.filter((a) => a.id !== areaId);
  return (
    <div className="area-team">
      <div className="area-team-row">
        <span className="area-team-icon" aria-hidden="true">
          <Users size={18} />
        </span>
        <div className="area-team-text">
          <div className="area-team-name">
            <strong>{team.name}</strong>
            {receivesNew && <span className="chip chip-ok">{t('Gets new tickets')}</span>}
          </div>
          <span className="meta">
            {t(team.people === 1 ? '{0} person' : '{0} people', { 0: team.people })} ·{' '}
            {team.managers.length ? t('Manager: {0}', { 0: team.managers.join(', ') }) : t('No manager yet')}
          </span>
        </div>
        <ActionMenu
          label={t('Actions for team {0}', { 0: team.name })}
          actions={[
            { label: t('Rename the team'), onSelect: () => (setName(team.name), setMode('rename')) },
            ...(receivesNew
              ? []
              : [
                  {
                    label: t('Make it get the new tickets'),
                    onSelect: () => change.mutate({ receivesNew: true })
                  }
                ]),
            ...(others.length
              ? [{ label: t('Move to another area…'), onSelect: () => (setTarget(''), setMode('move')) }]
              : []),
            { label: t('Delete the team'), danger: true, onSelect: () => setMode('delete') }
          ]}
        />
      </div>
      {mode === 'rename' && (
        <form
          className="area-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== team.name) change.mutate({ name: name.trim() });
            else setMode(null);
          }}
        >
          <label htmlFor={`rename-${team.id}`}>{t('Name of the team')}</label>
          <input id={`rename-${team.id}`} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <div className="btn-row">
            <button type="submit" className="btn btn-sm btn-primary" disabled={name.trim().length < 2}>
              {t('Save')}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setMode(null)}>
              {t('Cancel')}
            </button>
          </div>
        </form>
      )}
      {mode === 'move' && (
        <form
          className="area-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (target) change.mutate({ areaId: target });
          }}
        >
          <label htmlFor={`move-${team.id}`}>{t('Move {0} to the area', { 0: team.name })}</label>
          <select id={`move-${team.id}`} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t('Choose…')}</option>
            {others.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div className="btn-row">
            <button type="submit" className="btn btn-sm btn-primary" disabled={!target}>
              {t('Move')}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setMode(null)}>
              {t('Cancel')}
            </button>
          </div>
        </form>
      )}
      {mode === 'delete' && (
        <div className="area-inline">
          <span>{t('Delete the team {0}?', { 0: team.name })}</span>
          <div className="btn-row">
            <button type="button" className="btn btn-sm btn-danger" onClick={() => remove.mutate()}>
              {t('Delete')}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setMode(null)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Admin area → Areas and teams: where each team works. A ticket goes to the team of the area its place lies in. */
export function AreasPage() {
  useCrumbs([{ label: t('Administration') }, { label: t('Areas and teams') }]);
  const queryClient = useQueryClient();
  const areas = useQuery({ queryKey: ['admin-areas'], queryFn: () => api<AreaView[]>('/admin/areas') });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-areas'] });
    void queryClient.invalidateQueries({ queryKey: ['lookups'] });
  };
  const save = useMutation({
    mutationFn: (e: Editing) => {
      if (e.name.trim().length < 2) throw new Error(t('Give the area a name.'));
      if (e.shape.kind === 'drawn' && e.shape.ring.length < 3)
        throw new Error(t('Mark at least three corners on the map.'));
      const boundary: Boundary =
        e.shape.kind === 'file' ? e.shape.boundary : { type: 'Polygon', coordinates: [e.shape.ring] };
      const body = { name: e.name.trim(), boundary };
      return e.id
        ? api<AreaView>(`/admin/areas/${e.id}`, { method: 'PATCH', body })
        : api<AreaView>('/admin/areas', { method: 'POST', body });
    },
    onSuccess: (area) => {
      setEditing(null);
      setSelected(area.id);
      setError(null);
      refresh();
    },
    onError: (e) => setError(problem(e))
  });
  const removeArea = useMutation({
    mutationFn: (id: string) => api(`/admin/areas/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSelected(null);
      setError(null);
      refresh();
    },
    onError: (e) => setError(problem(e))
  });
  const addTeam = useMutation({
    mutationFn: ({ areaId, name }: { areaId: string; name: string }) =>
      api('/admin/teams', { method: 'POST', body: { areaId, name } }),
    onSuccess: (_r, { areaId }) => {
      setNewTeam((x) => ({ ...x, [areaId]: '' }));
      setAdding(null);
      setError(null);
      refresh();
    },
    onError: (e) => setError(problem(e))
  });

  const startNew = () => {
    setError(null);
    save.reset();
    setEditing({ id: null, name: '', shape: { kind: 'drawn', ring: [] } });
  };
  const startEdit = (a: AreaView) => {
    setError(null);
    save.reset();
    setSelected(a.id);
    // Drawn areas have one polygon; its outer ring without the closing corner becomes draggable corners.
    setEditing({
      id: a.id,
      name: a.name,
      shape:
        a.boundary.length === 1
          ? { kind: 'drawn', ring: a.boundary[0]![0]!.slice(0, -1) }
          : { kind: 'file', boundary: { type: 'MultiPolygon', coordinates: a.boundary }, fileName: '' }
    });
  };
  const setRing = (ring: LngLat[]) => setEditing((e) => (e ? { ...e, shape: { kind: 'drawn', ring } } : e));
  const readFile = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !editing) return;
    void file.text().then((text) => {
      try {
        const boundary = boundaryFromGeoJson(text);
        setEditing((e) => (e ? { ...e, shape: { kind: 'file', boundary, fileName: file.name } } : e));
        setError(null);
      } catch (err) {
        setError(err instanceof SyntaxError ? t('The file is not GeoJSON.') : (err as Error).message);
      }
    });
  };

  const list = areas.data ?? [];
  const shape = editing?.shape;
  const preview =
    shape?.kind === 'file'
      ? shape.boundary.type === 'Polygon'
        ? [shape.boundary.coordinates]
        : shape.boundary.coordinates
      : null;

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>{t('Areas and teams')}</h1>
          <div className="subtitle">
            {t('A new ticket goes to the team of its area marked "Gets new tickets". Areas cannot overlap.')}
          </div>
        </div>
        {!editing && (
          <button type="button" className="btn btn-primary btn-lg" onClick={startNew}>
            <Plus size={18} /> {t('Add area')}
          </button>
        )}
      </div>
      {(error ?? areas.error) && <div className="error">{error ?? (areas.error as Error).message}</div>}

      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(380px, 2fr)' }}>
        <section className="card card-pad" aria-label={t('Map of the areas')}>
          <AreaMap
            areas={editing ? list.filter((a) => a.id !== editing.id) : list}
            selectedId={selected}
            drawing={!!editing && shape?.kind === 'drawn'}
            draft={shape?.kind === 'drawn' ? shape.ring : []}
            preview={preview}
            onAdd={(p) => shape?.kind === 'drawn' && setRing([...shape.ring, p])}
            onMove={(i, p) => shape?.kind === 'drawn' && setRing(shape.ring.map((q, j) => (j === i ? p : q)))}
            onSelect={setSelected}
          />
        </section>

        {editing ? (
          <section className="card card-pad" style={{ gap: 16, alignSelf: 'start' }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>{editing.id ? t('Change the area') : t('New area')}</h2>
            <div className="field">
              <label htmlFor="area-name">{t('Name')}</label>
              <input
                id="area-name"
                value={editing.name}
                placeholder={t('e.g. Matola Norte')}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            {shape?.kind === 'drawn' ? (
              <>
                <div className="notice" style={{ margin: 0 }}>
                  {t(
                    'Click on the map to add the corners of the area, in order around it. Drag a corner to move it.'
                  )}
                </div>
                <div className="meta">{t('{0} corners', { 0: shape.ring.length })}</div>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!shape.ring.length}
                    onClick={() => setRing(shape.ring.slice(0, -1))}
                  >
                    {t('Remove the last corner')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!shape.ring.length}
                    onClick={() => setRing([])}
                  >
                    {t('Start again')}
                  </button>
                </div>
              </>
            ) : (
              <div className="notice" style={{ margin: 0 }}>
                {shape?.fileName
                  ? t('Boundary from {0}.', { 0: shape.fileName })
                  : t('This area has several parts; draw it again to replace them with one shape.')}{' '}
                <button type="button" className="link-button" onClick={() => setRing([])}>
                  {t('Draw on the map instead')}
                </button>
              </div>
            )}
            <label className="btn btn-sm" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
              <Upload size={14} /> {t('Read the boundary from a GeoJSON file')}
              <input
                type="file"
                accept=".json,.geojson,application/geo+json,application/json"
                hidden
                onChange={readFile}
              />
            </label>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                {t('Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={save.isPending}
                onClick={() => save.mutate(editing)}
              >
                {save.isPending ? t('Saving…') : t('Save')}
              </button>
            </div>
          </section>
        ) : (
          <div className="stack" style={{ alignSelf: 'start' }}>
            {list.length === 0 && areas.data && (
              <section className="card empty">{t('No areas yet. Add the first one.')}</section>
            )}
            {list.map((a) => (
              <section
                key={a.id}
                className={`card card-pad area-card${a.id === selected ? ' selected' : ''}`}
                onClick={() => setSelected(a.id)}
              >
                <div className="area-card-head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h2>{a.name}</h2>
                    <div className="meta">
                      {t('{0} km²', { 0: a.sizeKm2.toLocaleString() })} ·{' '}
                      {t(a.openTickets === 1 ? '{0} open ticket' : '{0} open tickets', { 0: a.openTickets })}{' '}
                      · {t(a.teams.length === 1 ? '{0} team' : '{0} teams', { 0: a.teams.length })}
                    </div>
                  </div>
                  <ActionMenu
                    label={t('Actions for area {0}', { 0: a.name })}
                    actions={[
                      { label: t('Change the name and boundary'), onSelect: () => startEdit(a) },
                      { label: t('Delete the area'), danger: true, onSelect: () => setDeleting(a.id) }
                    ]}
                  />
                </div>
                {deleting === a.id && (
                  <div className="area-inline">
                    <span>{t('Delete the area {0}?', { 0: a.name })}</span>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => {
                          setDeleting(null);
                          removeArea.mutate(a.id);
                        }}
                      >
                        {t('Delete')}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setDeleting(null)}>
                        {t('Cancel')}
                      </button>
                    </div>
                  </div>
                )}
                {a.teams.length === 0 ? (
                  <div className="meta area-empty">
                    {t('No team yet: tickets here wait for NOC to send them to a team.')}
                  </div>
                ) : (
                  <div className="area-teams">
                    {a.teams.map((team, i) => (
                      <TeamRow
                        key={team.id}
                        team={team}
                        areas={list}
                        areaId={a.id}
                        receivesNew={i === 0}
                        onError={setError}
                      />
                    ))}
                  </div>
                )}
                {adding === a.id ? (
                  <form
                    className="area-inline"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = newTeam[a.id]?.trim();
                      if (name) addTeam.mutate({ areaId: a.id, name });
                    }}
                  >
                    <label htmlFor={`new-team-${a.id}`}>{t('Name of the new team')}</label>
                    <input
                      id={`new-team-${a.id}`}
                      value={newTeam[a.id] ?? ''}
                      onChange={(e) => setNewTeam((x) => ({ ...x, [a.id]: e.target.value }))}
                      autoFocus
                    />
                    <div className="btn-row">
                      <button
                        type="submit"
                        className="btn btn-sm btn-primary"
                        disabled={!newTeam[a.id]?.trim()}
                      >
                        {t('Add team')}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setAdding(null)}>
                        {t('Cancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="link-button area-add-team"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAdding(a.id);
                    }}
                  >
                    <Plus size={15} /> {t('Add a team')}
                  </button>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
