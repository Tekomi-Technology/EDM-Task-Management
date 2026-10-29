import type { AreaView, Boundary } from '../types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Upload, Users } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { api, ApiRequestError } from '../api';
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
  onError
}: {
  team: AreaView['teams'][number];
  areas: AreaView[];
  areaId: string;
  onError: (message: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const done = () => {
    onError(null);
    void queryClient.invalidateQueries({ queryKey: ['admin-areas'] });
    void queryClient.invalidateQueries({ queryKey: ['lookups'] });
  };
  const change = useMutation({
    mutationFn: (body: { name?: string; areaId?: string }) =>
      api(`/admin/teams/${team.id}`, { method: 'PATCH', body }),
    onSuccess: done,
    onError: (e) => onError(problem(e))
  });
  const remove = useMutation({
    mutationFn: () => api(`/admin/teams/${team.id}`, { method: 'DELETE' }),
    onSuccess: done,
    onError: (e) => onError(problem(e))
  });
  return (
    <div className="area-team">
      <Users size={16} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{team.name}</strong>
        <div className="meta">
          {t(team.people === 1 ? '{0} person' : '{0} people', { 0: team.people })}
          {team.managers.length ? ` · ${t('manager')}: ${team.managers.join(', ')}` : ''}
        </div>
      </div>
      <select
        aria-label={t('Move {0} to another area', { 0: team.name })}
        value={areaId}
        onChange={(e) => change.mutate({ areaId: e.target.value })}
      >
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-sm"
        aria-label={t('Rename {0}', { 0: team.name })}
        onClick={() => {
          const name = window.prompt(t('New name of the team'), team.name)?.trim();
          if (name && name !== team.name) change.mutate({ name });
        }}
      >
        <Pencil size={14} />
      </button>
      <button
        type="button"
        className="btn btn-sm"
        aria-label={t('Delete {0}', { 0: team.name })}
        onClick={() => {
          if (window.confirm(t('Delete the team {0}?', { 0: team.name }))) remove.mutate();
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/** Settings → Areas and teams: where each team works. A ticket goes to the team of the area its place lies in. */
export function AreasPage() {
  useCrumbs([{ label: t('Settings') }, { label: t('Areas and teams') }]);
  const queryClient = useQueryClient();
  const areas = useQuery({ queryKey: ['admin-areas'], queryFn: () => api<AreaView[]>('/admin/areas') });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState<Record<string, string>>({});

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
            {t('A new ticket goes to the first team of the area its place lies in. Areas cannot overlap.')}
          </div>
        </div>
        {!editing && (
          <button type="button" className="btn btn-primary btn-lg" onClick={startNew}>
            <Plus size={18} /> {t('Add area')}
          </button>
        )}
      </div>
      {(error ?? areas.error) && <div className="error">{error ?? (areas.error as Error).message}</div>}

      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(340px, 440px)' }}>
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
                style={{ gap: 12 }}
                onClick={() => setSelected(a.id)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h2 style={{ margin: 0, fontSize: 18 }}>{a.name}</h2>
                    <div className="meta">
                      {t('{0} km²', { 0: a.sizeKm2.toLocaleString() })} ·{' '}
                      {t(a.openTickets === 1 ? '{0} open ticket' : '{0} open tickets', { 0: a.openTickets })}
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => startEdit(a)}>
                    <Pencil size={14} /> {t('Change')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-label={t('Delete {0}', { 0: a.name })}
                    onClick={() => {
                      if (window.confirm(t('Delete the area {0}?', { 0: a.name }))) removeArea.mutate(a.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {a.teams.length === 0 ? (
                  <div className="meta">
                    {t('No team yet: tickets here wait for NOC to send them to a team.')}
                  </div>
                ) : (
                  a.teams.map((team, i) => (
                    <div key={team.id}>
                      <TeamRow team={team} areas={list} areaId={a.id} onError={setError} />
                      {i === 0 && a.teams.length > 1 && (
                        <div className="meta" style={{ marginLeft: 26 }}>
                          {t('Gets the new tickets of this area')}
                        </div>
                      )}
                    </div>
                  ))
                )}
                <form
                  className="btn-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = newTeam[a.id]?.trim();
                    if (name) addTeam.mutate({ areaId: a.id, name });
                  }}
                >
                  <input
                    aria-label={t('New team in {0}', { 0: a.name })}
                    placeholder={t('New team name')}
                    value={newTeam[a.id] ?? ''}
                    onChange={(e) => setNewTeam((x) => ({ ...x, [a.id]: e.target.value }))}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button type="submit" className="btn btn-sm" disabled={!newTeam[a.id]?.trim()}>
                    <Plus size={14} /> {t('Add team')}
                  </button>
                </form>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
