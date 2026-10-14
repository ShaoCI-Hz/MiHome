/** 本地定时执行场景（本机自动化）：列表 + 启停 + 新建/删除 */
import { useState } from 'react';
import type { MiScene } from '../api/types';
import {
  daysText,
  loadSchedules,
  newId,
  saveSchedules,
  type LocalSchedule,
} from '../api/schedule';
import { toast } from './Toast';

interface Props {
  scenes: MiScene[];
  currentHomeId: string | null;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export function SchedulePanel({ scenes, currentHomeId }: Props) {
  const [list, setList] = useState<LocalSchedule[]>(() => loadSchedules());
  const [editingNew, setEditingNew] = useState(false);
  const [sceneId, setSceneId] = useState('');
  const [time, setTime] = useState('08:00');
  const [days, setDays] = useState<number[]>([]); // 空=每天

  const persist = (next: LocalSchedule[]) => {
    setList(next);
    saveSchedules(next);
  };

  const toggleEnabled = (id: string) => {
    persist(list.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  };

  const remove = (id: string) => {
    if (!window.confirm('删除该定时任务？')) return;
    persist(list.filter((s) => s.id !== id));
  };

  const add = () => {
    const scene = scenes.find((s) => String(s.scene_id) === sceneId);
    if (!scene || !currentHomeId) {
      toast('请先选择要执行的场景', 'err');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      toast('请填写触发时间', 'err');
      return;
    }
    persist([
      ...list,
      {
        id: newId(),
        sceneId: String(scene.scene_id),
        sceneName: scene.name,
        homeId: String(scene.home_id ?? currentHomeId),
        time,
        days: [...days].sort((a, b) => a - b),
        enabled: true,
      },
    ]);
    setEditingNew(false);
    setSceneId('');
    setTime('08:00');
    setDays([]);
    toast('定时任务已创建', 'ok');
  };

  return (
    <div className="mi-schedule">
      <div className="mi-section-title">
        定时执行（本地）
        <button className="mi-schedule-add" onClick={() => setEditingNew((v) => !v)}>
          {editingNew ? '取消' : '+ 新建'}
        </button>
      </div>
      <p className="mi-schedule-note">
        本机定时触发手动场景，无需云端自动化；应用最小化到托盘时同样生效。数据仅存本机。
      </p>

      {editingNew && (
        <div className="mi-schedule-form">
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
            <option value="">选择场景…</option>
            {scenes.map((s) => (
              <option key={s.scene_id} value={String(s.scene_id)}>{s.name}</option>
            ))}
          </select>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <div className="mi-schedule-days">
            {WEEK.map((w, i) => (
              <button
                key={i}
                className={days.includes(i) || days.length === 0 ? 'on' : ''}
                title={days.length === 0 ? '每天（点击改为仅选中日）' : undefined}
                onClick={() => {
                  // 空=每天；首次点某天=切到"仅选中日"模式
                  const base = days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : days;
                  const next = base.includes(i) ? base.filter((d) => d !== i) : [...base, i];
                  setDays(next.length === 7 ? [] : next);
                }}
              >
                {w}
              </button>
            ))}
          </div>
          <button className="mi-schedule-save" onClick={add}>保存</button>
        </div>
      )}

      {list.length === 0 && !editingNew && (
        <div className="mi-empty" style={{ padding: '12px 0' }}>暂无定时任务</div>
      )}
      {list.map((s) => (
        <div key={s.id} className="mi-schedule-item">
          <b className="mi-schedule-time">{s.time}</b>
          <div className="mi-schedule-info">
            <span>{s.sceneName}</span>
            <em>{daysText(s.days)}</em>
          </div>
          <button
            className={`mi-toggle ${s.enabled ? 'on' : ''}`}
            role="switch"
            aria-checked={s.enabled}
            aria-label={`启用定时任务 ${s.sceneName}`}
            onClick={() => toggleEnabled(s.id)}
          >
            <span className="mi-toggle-knob" />
          </button>
          <button className="mi-schedule-del" onClick={() => remove(s.id)} aria-label="删除定时任务">
            删除
          </button>
        </div>
      ))}
    </div>
  );
}
