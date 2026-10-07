import React, { useState, useEffect } from 'react';
import { schedulerService } from '../services/schedule/schedulerService';
import { ActiveScheduleSnapshot, ScheduleCategory, ScheduleEvent } from '../services/schedule/types';
import { stationProfileManager } from '../services/profile/stationProfileManager';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const ScheduleWorkspace: React.FC = () => {
  const [snapshot, setSnapshot] = useState<ActiveScheduleSnapshot>(schedulerService.getSnapshot());
  const [events, setEvents] = useState<ScheduleEvent[]>(schedulerService.getEvents());
  const [selectedDay, setSelectedDay] = useState<number | 'all'>('all');
  const [viewMode, setViewMode] = useState<'agenda' | 'grid'>('agenda');
  const [activeProfile, setActiveProfile] = useState(stationProfileManager.getActiveProfile());

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formHost, setFormHost] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState<ScheduleCategory>('LIVE_TALK');
  const [formDays, setFormDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [formStartTime, setFormStartTime] = useState('08:00');
  const [formEndTime, setFormEndTime] = useState('09:30');
  const [formAutoMeta, setFormAutoMeta] = useState(true);
  const [formAutoRecord, setFormAutoRecord] = useState(true);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubSched = schedulerService.subscribe((snap, list) => {
      setSnapshot(snap);
      setEvents(list);
    });

    const unsubProfile = stationProfileManager.subscribe((_, active) => {
      setActiveProfile(active);
    });

    return () => {
      unsubSched();
      unsubProfile();
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleOpenAddModal = () => {
    setEditingId(null);
    setFormTitle('');
    setFormHost(activeProfile.defaultArtist || 'Presenter Studio');
    setFormDescription('');
    setFormCategory('LIVE_TALK');
    setFormDays([1, 2, 3, 4, 5]);
    setFormStartTime('08:00');
    setFormEndTime('09:30');
    setFormAutoMeta(true);
    setFormAutoRecord(true);
    setShowModal(true);
  };

  const handleOpenEditModal = (ev: ScheduleEvent) => {
    setEditingId(ev.id);
    setFormTitle(ev.title);
    setFormHost(ev.host);
    setFormDescription(ev.description);
    setFormCategory(ev.category);
    setFormDays(ev.daysOfWeek);
    setFormStartTime(ev.startTime);
    setFormEndTime(ev.endTime);
    setFormAutoMeta(ev.autoUpdateMetadata);
    setFormAutoRecord(ev.autoStartRecording);
    setShowModal(true);
  };

  const handleSaveModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      showToast('Program title is required');
      return;
    }

    if (editingId) {
      schedulerService.updateEvent(editingId, {
        title: formTitle.trim(),
        host: formHost.trim(),
        description: formDescription.trim(),
        category: formCategory,
        daysOfWeek: formDays,
        startTime: formStartTime,
        endTime: formEndTime,
        autoUpdateMetadata: formAutoMeta,
        autoStartRecording: formAutoRecord,
      });
      showToast(`Updated program: ${formTitle}`);
    } else {
      schedulerService.addEvent({
        title: formTitle.trim(),
        host: formHost.trim(),
        description: formDescription.trim(),
        category: formCategory,
        daysOfWeek: formDays,
        startTime: formStartTime,
        endTime: formEndTime,
        color: '#D9FF55',
        enabled: true,
        autoUpdateMetadata: formAutoMeta,
        autoStartRecording: formAutoRecord,
        autoStopRecordingAtEnd: true,
      });
      showToast(`Added program: ${formTitle}`);
    }

    setShowModal(false);
  };

  const handleDeleteEvent = (id: string, name: string) => {
    schedulerService.deleteEvent(id);
    showToast(`Removed program: ${name}`);
  };

  const handleToggleEnable = (ev: ScheduleEvent) => {
    const nextVal = !ev.enabled;
    schedulerService.updateEvent(ev.id, { enabled: nextVal });
    showToast(`Program "${ev.title}" ${nextVal ? 'ENABLED' : 'DISABLED'}`);
  };

  const handleTriggerManual = async (ev: ScheduleEvent) => {
    await schedulerService.triggerEventManual(ev.id);
    showToast(`Manually activated program: "${ev.title}"`);
  };

  const handleExportSchedule = () => {
    const json = schedulerService.exportScheduleJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `broadcst_schedule_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Schedule exported to JSON');
  };

  const handleImportSchedule = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          const content = re.target?.result as string;
          if (content && schedulerService.importScheduleJson(content)) {
            showToast('Schedule successfully imported');
          } else {
            showToast('Failed to import schedule JSON');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const toggleDaySelection = (dayNum: number) => {
    setFormDays((prev) =>
      prev.includes(dayNum) ? prev.filter((d) => d !== dayNum) : [...prev, dayNum].sort()
    );
  };

  const filteredEvents = events.filter((ev) => {
    if (selectedDay === 'all') return true;
    return ev.daysOfWeek.includes(selectedDay);
  });

  return (
    <section className="ws-workspace ws-schedule-layout" aria-label="Broadcast Schedule Station">
      {/* Command & Control Bar */}
      <div className="ws-command-row">
        <div>
          <div className="ws-kicker">Production / Timetable</div>
          <h1 className="ws-title">Broadcast Schedule & Automation</h1>
          <p className="ws-subtitle">
            Time-locked program agenda with automatic metadata generation and session archiving.
          </p>
        </div>

        <div className="ws-transport">
          <div className="ws-tabs">
            <button
              type="button"
              className="ws-tab-btn"
              data-active={viewMode === 'agenda'}
              onClick={() => setViewMode('agenda')}
            >
              Agenda Stream
            </button>
            <button
              type="button"
              className="ws-tab-btn"
              data-active={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
            >
              24h Timeline
            </button>
          </div>

          <button
            type="button"
            className="ws-secondary-action"
            onClick={handleExportSchedule}
            title="Export Schedule JSON"
          >
            Export JSON
          </button>
          <button
            type="button"
            className="ws-secondary-action"
            onClick={handleImportSchedule}
            title="Import Schedule JSON"
          >
            Import JSON
          </button>
          <button
            type="button"
            className="ws-primary-action"
            onClick={handleOpenAddModal}
          >
            + Add Program
          </button>
        </div>
      </div>

      {/* Schedule Hero Strip (Current & Next Program) */}
      <div className="ws-schedule-header-hero">
        {/* Current Program */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="ws-kicker">Current Slot</span>
            <span className="ws-badge" data-variant={snapshot.currentEvent ? 'live' : 'neutral'}>
              {snapshot.currentEvent ? '● ON AIR NOW' : 'STATION ROTATION'}
            </span>
          </div>

          {snapshot.currentEvent ? (
            <div>
              <div style={{ fontSize: '16px', fontWeight: 760, color: 'var(--ws-text)' }}>
                {snapshot.currentEvent.title}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
                {snapshot.currentEvent.host} • {snapshot.currentEvent.startTime} - {snapshot.currentEvent.endTime}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                {snapshot.currentEvent.autoStartRecording && (
                  <span className="ws-tag" style={{ color: 'var(--ws-live)' }}>
                    ● AUTO-RECORDING
                  </span>
                )}
                {snapshot.currentEvent.autoUpdateMetadata && (
                  <span className="ws-tag">AUTO-METADATA</span>
                )}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: 'var(--ws-muted)' }}>
              Standard station rotation playlist active. No special live schedule slot.
            </div>
          )}
        </div>

        {/* Next Program */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            borderLeft: '1px solid var(--ws-line)',
            paddingLeft: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="ws-kicker">Upcoming Program</span>
            <span className="ws-tag" style={{ fontFamily: 'var(--font-mono)' }}>
              {snapshot.nextEvent && snapshot.timeUntilNextSec > 0
                ? `Starts in ${Math.floor(snapshot.timeUntilNextSec / 60)}m ${snapshot.timeUntilNextSec % 60}s`
                : 'Next Queue'}
            </span>
          </div>

          {snapshot.nextEvent ? (
            <div>
              <div style={{ fontSize: '15px', fontWeight: 720, color: 'var(--ws-text)' }}>
                {snapshot.nextEvent.title}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
                {snapshot.nextEvent.host} • Starts at {snapshot.nextEvent.startTime}
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--ws-subtle)', marginTop: '4px' }}>
                {snapshot.nextEvent.description || 'Program scheduled in weekly lineup'}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: 'var(--ws-muted)' }}>
              No subsequent programs scheduled for today.
            </div>
          )}
        </div>
      </div>

      {/* Main Agenda / Grid Content */}
      <div
        style={{
          border: '1px solid var(--ws-line)',
          borderRadius: '7px',
          background: 'var(--ws-panel)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Day of Week Selector */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 14px',
            borderBottom: '1px solid var(--ws-line)',
            background: 'var(--ws-panel-2)',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              className="ws-tab-btn"
              data-active={selectedDay === 'all'}
              onClick={() => setSelectedDay('all')}
            >
              All Days ({events.length})
            </button>
            {DAY_NAMES.map((name, idx) => (
              <button
                key={name}
                type="button"
                className="ws-tab-btn"
                data-active={selectedDay === idx}
                onClick={() => setSelectedDay(idx)}
              >
                {name}
              </button>
            ))}
          </div>

          <div style={{ fontSize: '11px', color: 'var(--ws-muted)' }}>
            Showing {filteredEvents.length} program(s)
          </div>
        </div>

        {/* Event List or Timeline Grid */}
        <div style={{ padding: '14px', overflowY: 'auto', flex: 1 }}>
          {filteredEvents.length === 0 ? (
            <div className="ws-empty">
              <div>
                <strong>No Programs Scheduled for Selected Filter</strong>
                <p>Click "+ Add Program" to schedule a live show, lecture, or automated playlist block.</p>
              </div>
            </div>
          ) : viewMode === 'agenda' ? (
            <div>
              {filteredEvents.map((ev) => {
                const isCurrent = snapshot.currentEvent?.id === ev.id;

                return (
                  <div
                    key={ev.id}
                    className="ws-program-row"
                    data-current={isCurrent}
                  >
                    {/* Time Pill */}
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: isCurrent ? 'var(--ws-live)' : 'var(--ws-text)' }}>
                      <strong>{ev.startTime}</strong>
                      <span style={{ color: 'var(--ws-subtle)', margin: '0 3px' }}>-</span>
                      <span>{ev.endTime}</span>
                    </div>

                    {/* Program Info */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: isCurrent ? 'var(--ws-live)' : 'var(--ws-text)' }}>
                        {ev.title}
                      </div>
                      <div style={{ fontSize: '10.5px', color: 'var(--ws-muted)', marginTop: '2px' }}>
                        Host: {ev.host} • Days: {ev.daysOfWeek.map((d) => DAY_NAMES[d]).join(', ')}
                      </div>
                    </div>

                    {/* Status & Category */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <span
                        className="ws-badge"
                        data-variant={isCurrent ? 'live' : ev.enabled ? 'neutral' : 'warning'}
                        style={{ fontSize: '9px', padding: '1px 5px', width: 'fit-content' }}
                      >
                        {isCurrent ? 'ACTIVE' : ev.enabled ? 'ENABLED' : 'DISABLED'}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--ws-muted)' }}>
                        {ev.category.replace('_', ' ')}
                      </span>
                    </div>

                    {/* Automation Flags */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {ev.autoStartRecording && (
                        <span className="ws-tag" style={{ color: 'var(--ws-live)' }}>
                          ● REC
                        </span>
                      )}
                      {ev.autoUpdateMetadata && (
                        <span className="ws-tag">METADATA</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ textAlign: 'right', display: 'flex', gap: '4px', justifyContent: 'flex-end', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="ws-mini-action"
                        style={{ color: 'var(--ws-live)' }}
                        onClick={() => handleTriggerManual(ev)}
                        title="Immediately trigger this scheduled program block"
                      >
                        ▶ Run Now
                      </button>
                      <button
                        type="button"
                        className="ws-mini-action"
                        style={{ color: ev.enabled ? 'var(--ws-muted)' : 'var(--ws-warning)' }}
                        onClick={() => handleToggleEnable(ev)}
                        title={ev.enabled ? 'Disable this scheduled program' : 'Enable this scheduled program'}
                      >
                        {ev.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        className="ws-mini-action"
                        onClick={() => handleOpenEditModal(ev)}
                        title="Edit program parameters"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ws-mini-action"
                        style={{ color: 'var(--ws-danger)' }}
                        onClick={() => handleDeleteEvent(ev.id, ev.title)}
                        title="Delete program"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* 24h Timeline Visual Representation */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '11px', color: 'var(--ws-muted)', marginBottom: '8px' }}>
                Visual 24-hour broadcast day progression:
              </div>
              <div
                style={{
                  position: 'relative',
                  height: '60px',
                  background: 'var(--ws-panel-2)',
                  border: '1px solid var(--ws-line)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  overflow: 'hidden',
                }}
              >
                {filteredEvents.map((ev, index) => {
                  const [startH] = ev.startTime.split(':').map(Number);
                  const [endH] = ev.endTime.split(':').map(Number);
                  const leftPct = (startH / 24) * 100;
                  const widthPct = Math.max(4, ((endH - startH) / 24) * 100);

                  return (
                    <div
                      key={ev.id}
                      style={{
                        position: 'absolute',
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        height: '42px',
                        background: index % 2 === 0 ? 'var(--ws-panel-3)' : 'color-mix(in srgb, var(--ws-live) 15%, var(--ws-panel-3))',
                        border: '1px solid var(--ws-line)',
                        borderRadius: '4px',
                        padding: '4px 6px',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        fontSize: '10px',
                        color: 'var(--ws-text)',
                        cursor: 'pointer',
                      }}
                      onClick={() => handleOpenEditModal(ev)}
                      title={`${ev.title} (${ev.startTime} - ${ev.endTime})`}
                    >
                      <strong style={{ display: 'block' }}>{ev.title}</strong>
                      <span style={{ fontSize: '8.5px', color: 'var(--ws-subtle)' }}>{ev.startTime}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--ws-subtle)' }}>
                <span>00:00</span>
                <span>04:00</span>
                <span>08:00</span>
                <span>12:00</span>
                <span>16:00</span>
                <span>20:00</span>
                <span>24:00</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Program Modal (Add/Edit) */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 'min(500px, 92vw)',
              background: 'var(--ws-panel)',
              border: '1px solid var(--ws-line)',
              borderRadius: '8px',
              padding: '18px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 760 }}>
                {editingId ? 'Edit Program Schedule' : 'Schedule New Broadcast Program'}
              </h3>
              <button
                type="button"
                className="ws-mini-action"
                onClick={() => setShowModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveModal} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label className="ws-form-label">Program Title</label>
                <input
                  type="text"
                  className="ws-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. Kajian Subuh Berkah"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="ws-form-label">Presenter / Host / Speaker</label>
                <input
                  type="text"
                  className="ws-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. Ustadz Pemateri"
                  value={formHost}
                  onChange={(e) => setFormHost(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="ws-form-label">Start Time</label>
                  <input
                    type="time"
                    className="ws-input"
                    style={{ width: '100%' }}
                    value={formStartTime}
                    onChange={(e) => setFormStartTime(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="ws-form-label">End Time</label>
                  <input
                    type="time"
                    className="ws-input"
                    style={{ width: '100%' }}
                    value={formEndTime}
                    onChange={(e) => setFormEndTime(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="ws-form-label">Days of Week</label>
                <div style={{ display: 'flex', gap: '5px' }}>
                  {DAY_NAMES.map((dName, dIdx) => {
                    const isSelected = formDays.includes(dIdx);
                    return (
                      <button
                        key={dName}
                        type="button"
                        className="ws-mini-action"
                        style={{
                          flex: 1,
                          borderColor: isSelected ? 'var(--ws-live)' : undefined,
                          color: isSelected ? 'var(--ws-live)' : undefined,
                        }}
                        onClick={() => toggleDaySelection(dIdx)}
                      >
                        {dName}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="ws-form-label">Program Category</label>
                <select
                  className="ws-select"
                  style={{ width: '100%' }}
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as any)}
                >
                  <option value="LIVE_TALK">Live Talk / Dialog Interaktif</option>
                  <option value="KAJIAN">Kajian Tematik / Audio Khutbah</option>
                  <option value="MUSIC_BLOCK">Music / Jingle Block</option>
                  <option value="NEWS_BULLETIN">News & Warta Siaran</option>
                  <option value="AUTOMATION_FILL">Automation Fill</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--ws-text)' }}>
                  <input
                    type="checkbox"
                    checked={formAutoRecord}
                    onChange={(e) => setFormAutoRecord(e.target.checked)}
                    style={{ accentColor: 'var(--ws-live)' }}
                  />
                  Automatically Start Master Session Recording for this slot
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--ws-text)' }}>
                  <input
                    type="checkbox"
                    checked={formAutoMeta}
                    onChange={(e) => setFormAutoMeta(e.target.checked)}
                    style={{ accentColor: 'var(--ws-live)' }}
                  />
                  Push program title & host to ICY metadata stream
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
                <button
                  type="button"
                  className="ws-secondary-action"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="ws-primary-action">
                  {editingId ? 'Save Changes' : 'Schedule Program'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toastMessage && <div className="ws-toast">{toastMessage}</div>}
    </section>
  );
};
