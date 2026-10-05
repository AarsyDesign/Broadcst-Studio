import React, { useState, useEffect } from 'react';
import { schedulerService } from '../services/schedule/schedulerService';
import { ActiveScheduleSnapshot, ScheduleCategory, ScheduleEvent } from '../services/schedule/types';
import { stationProfileManager } from '../services/profile/stationProfileManager';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
  const [formColor, setFormColor] = useState('#D9FF55');
  const [formAutoMeta, setFormAutoMeta] = useState(true);
  const [formAutoRecord, setFormAutoRecord] = useState(true);
  const [formAutoStopRecord, setFormAutoStopRecord] = useState(true);

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
    setFormColor('#D9FF55');
    setFormAutoMeta(true);
    setFormAutoRecord(true);
    setFormAutoStopRecord(true);
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
    setFormColor(ev.color);
    setFormAutoMeta(ev.autoUpdateMetadata);
    setFormAutoRecord(ev.autoStartRecording);
    setFormAutoStopRecord(ev.autoStopRecordingAtEnd);
    setShowModal(true);
  };

  const handleSaveModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      showToast('Title is required');
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
        color: formColor,
        autoUpdateMetadata: formAutoMeta,
        autoStartRecording: formAutoRecord,
        autoStopRecordingAtEnd: formAutoStopRecord,
      });
      showToast(`Updated schedule for "${formTitle}"`);
    } else {
      schedulerService.addEvent({
        title: formTitle.trim(),
        host: formHost.trim(),
        description: formDescription.trim(),
        category: formCategory,
        daysOfWeek: formDays,
        startTime: formStartTime,
        endTime: formEndTime,
        color: formColor,
        enabled: true,
        autoUpdateMetadata: formAutoMeta,
        autoStartRecording: formAutoRecord,
        autoStopRecordingAtEnd: formAutoStopRecord,
      });
      showToast(`Added new program "${formTitle}"`);
    }

    setShowModal(false);
  };

  const handleToggleDay = (day: number) => {
    if (formDays.includes(day)) {
      if (formDays.length > 1) {
        setFormDays(formDays.filter((d) => d !== day));
      }
    } else {
      setFormDays([...formDays, day].sort());
    }
  };

  const handleTriggerNow = async (id: string, title: string) => {
    await schedulerService.triggerEventManual(id);
    showToast(`Manually triggered program: "${title}"`);
  };

  const handleToggleEvent = (id: string, title: string) => {
    const newState = schedulerService.toggleEvent(id);
    showToast(`Program "${title}" ${newState ? 'enabled' : 'disabled'}`);
  };

  const handleDeleteEvent = (id: string, title: string) => {
    if (confirm(`Remove program "${title}" from schedule?`)) {
      schedulerService.deleteEvent(id);
      showToast(`Removed "${title}"`);
    }
  };

  const formatCountdown = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const filteredEvents = events.filter((ev) => {
    if (selectedDay === 'all') return true;
    return ev.daysOfWeek.includes(selectedDay);
  }).sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--color-bg)',
        overflow: 'hidden',
      }}
    >
      {/* Header Bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-6)',
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-h2)', margin: 0, fontWeight: 700, textTransform: 'uppercase' }}>
              Broadcast Timetable & Scheduler
            </h1>
            <p style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', margin: '2px 0 0 0' }}>
              Automated show scheduling, metadata transitions, and top-of-the-hour broadcast events.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {/* Station Clock */}
          <div
            style={{
              padding: 'var(--space-1) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)' }}>STATION TIME:</span>
            <span style={{ fontSize: 'var(--text-body)', fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-live)' }}>
              {snapshot.currentTimeString}
            </span>
          </div>

          <button
            onClick={handleOpenAddModal}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              backgroundColor: 'var(--color-live)',
              color: 'var(--color-live-text)',
              fontWeight: 600,
              fontSize: 'var(--text-small)',
              cursor: 'pointer',
            }}
          >
            + Add Program
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'absolute',
            top: 50,
            right: 24,
            padding: 'var(--space-2) var(--space-4)',
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-live)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-small)',
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Main Container */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        {/* On Air & Up Next Live Tracker Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          {/* NOW AIRING CARD */}
          <div
            style={{
              padding: 'var(--space-4)',
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              borderLeft: snapshot.currentEvent ? `4px solid ${snapshot.currentEvent.color}` : '4px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: snapshot.currentEvent ? 'var(--color-live)' : 'var(--color-text-muted)',
                      boxShadow: snapshot.currentEvent ? '0 0 6px var(--color-live)' : 'none',
                    }}
                  />
                  <span style={{ fontSize: 'var(--text-micro)', fontWeight: 700, color: 'var(--color-live)', letterSpacing: '0.05em' }}>
                    NOW AIRING
                  </span>
                </div>

                {snapshot.currentEvent && (
                  <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                    {snapshot.currentEvent.startTime} - {snapshot.currentEvent.endTime}
                  </span>
                )}
              </div>

              {snapshot.currentEvent ? (
                <>
                  <div style={{ fontSize: 'var(--text-h2)', fontWeight: 700, marginBottom: '2px' }}>
                    {snapshot.currentEvent.title}
                  </div>
                  <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                    Host / Presenter: {snapshot.currentEvent.host}
                  </div>
                  <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                    {snapshot.currentEvent.description}
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-body)' }}>
                  No scheduled program currently in slot. Station running in open rotation mode.
                </div>
              )}
            </div>

            {snapshot.currentEvent && (
              <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)' }}>
                  Time Remaining: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-text-primary)' }}>{formatCountdown(snapshot.timeRemainingSec)}</span>
                </div>
                <button
                  onClick={() => handleTriggerNow(snapshot.currentEvent!.id, snapshot.currentEvent!.title)}
                  style={{
                    padding: '2px var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-elevated)',
                    color: 'var(--color-text-primary)',
                    fontSize: 'var(--text-micro)',
                    cursor: 'pointer',
                  }}
                >
                  Push Metadata Now
                </button>
              </div>
            )}
          </div>

          {/* UP NEXT CARD */}
          <div
            style={{
              padding: 'var(--space-4)',
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              borderLeft: snapshot.nextEvent ? `4px solid ${snapshot.nextEvent.color}` : '4px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--text-micro)', fontWeight: 700, color: 'var(--color-info)', letterSpacing: '0.05em' }}>
                  UP NEXT
                </span>
                {snapshot.nextEvent && (
                  <span style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                    Starts at {snapshot.nextEvent.startTime}
                  </span>
                )}
              </div>

              {snapshot.nextEvent ? (
                <>
                  <div style={{ fontSize: 'var(--text-h2)', fontWeight: 700, marginBottom: '2px' }}>
                    {snapshot.nextEvent.title}
                  </div>
                  <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                    Host / Presenter: {snapshot.nextEvent.host}
                  </div>
                  <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)' }}>
                    {snapshot.nextEvent.description}
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-body)' }}>
                  No upcoming programs scheduled for next timeblock.
                </div>
              )}
            </div>

            {snapshot.nextEvent && (
              <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)' }}>
                  Starts in: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-info)' }}>{formatCountdown(snapshot.timeUntilNextSec)}</span>
                </div>
                <button
                  onClick={() => handleTriggerNow(snapshot.nextEvent!.id, snapshot.nextEvent!.title)}
                  style={{
                    padding: '2px var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-elevated)',
                    color: 'var(--color-text-primary)',
                    fontSize: 'var(--text-micro)',
                    cursor: 'pointer',
                  }}
                >
                  Start Show Early
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filter & View Mode Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-2) 0',
          }}
        >
          {/* Day Selector Pills */}
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            <button
              onClick={() => setSelectedDay('all')}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                backgroundColor: selectedDay === 'all' ? 'var(--color-surface-elevated)' : 'var(--color-surface)',
                color: selectedDay === 'all' ? 'var(--color-live)' : 'var(--color-text-secondary)',
                fontWeight: selectedDay === 'all' ? 700 : 400,
                fontSize: 'var(--text-small)',
                cursor: 'pointer',
              }}
            >
              All Days ({events.length})
            </button>
            {DAY_NAMES.map((name, idx) => (
              <button
                key={name}
                onClick={() => setSelectedDay(idx)}
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: selectedDay === idx ? 'var(--color-surface-elevated)' : 'var(--color-surface)',
                  color: selectedDay === idx ? 'var(--color-live)' : 'var(--color-text-secondary)',
                  fontWeight: selectedDay === idx ? 700 : 400,
                  fontSize: 'var(--text-small)',
                  cursor: 'pointer',
                }}
              >
                {name}
              </button>
            ))}
          </div>

          {/* View Mode Toggle */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px',
            }}
          >
            <button
              onClick={() => setViewMode('agenda')}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                backgroundColor: viewMode === 'agenda' ? 'var(--color-surface-elevated)' : 'transparent',
                color: viewMode === 'agenda' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                fontSize: 'var(--text-small)',
                cursor: 'pointer',
              }}
            >
              Timeline List
            </button>
            <button
              onClick={() => setViewMode('grid')}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                backgroundColor: viewMode === 'grid' ? 'var(--color-surface-elevated)' : 'transparent',
                color: viewMode === 'grid' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                fontSize: 'var(--text-small)',
                cursor: 'pointer',
              }}
            >
              Weekly Grid
            </button>
          </div>
        </div>

        {/* Timetable View 1: Agenda Timeline List */}
        {viewMode === 'agenda' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {filteredEvents.length === 0 ? (
              <div
                style={{
                  padding: 'var(--space-6)',
                  textAlign: 'center',
                  backgroundColor: 'var(--color-surface)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                No programs scheduled for the selected day filter. Click "+ Add Program" to schedule one.
              </div>
            ) : (
              filteredEvents.map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--space-4)',
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderLeft: `4px solid ${ev.color}`,
                    borderRadius: 'var(--radius-sm)',
                    opacity: ev.enabled ? 1 : 0.5,
                  }}
                >
                  {/* Left: Time and Title */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                    <div style={{ minWidth: 120 }}>
                      <div style={{ fontSize: 'var(--text-h2)', fontWeight: 700, fontFamily: 'monospace' }}>
                        {ev.startTime}
                      </div>
                      <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                        until {ev.endTime}
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '2px' }}>
                        <span style={{ fontSize: 'var(--text-body)', fontWeight: 700 }}>{ev.title}</span>
                        <span
                          style={{
                            padding: '1px 6px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--text-micro)',
                            backgroundColor: 'var(--color-surface-elevated)',
                            border: '1px solid var(--color-border)',
                            color: 'var(--color-text-secondary)',
                          }}
                        >
                          {ev.category.replace('_', ' ')}
                        </span>
                      </div>

                      <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)' }}>
                        Host: {ev.host} | Days: {ev.daysOfWeek.map((d) => DAY_NAMES[d]).join(', ')}
                      </div>

                      {ev.description && (
                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                          {ev.description}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions and Toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      {ev.autoUpdateMetadata && (
                        <span
                          title="Auto updates stream metadata"
                          style={{
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--text-micro)',
                            backgroundColor: 'rgba(217, 255, 85, 0.1)',
                            color: 'var(--color-live)',
                            border: '1px solid var(--color-live)',
                          }}
                        >
                          AUTO-META
                        </span>
                      )}
                      {ev.autoStartRecording && (
                        <span
                          title="Auto starts recording"
                          style={{
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--text-micro)',
                            backgroundColor: 'rgba(255, 92, 108, 0.1)',
                            color: 'var(--color-error)',
                            border: '1px solid var(--color-error)',
                          }}
                        >
                          RECORDER
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => handleTriggerNow(ev.id, ev.title)}
                      style={{
                        padding: 'var(--space-1) var(--space-3)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'var(--color-surface-elevated)',
                        color: 'var(--color-text-primary)',
                        fontSize: 'var(--text-small)',
                        cursor: 'pointer',
                      }}
                    >
                      Air Now
                    </button>

                    <button
                      onClick={() => handleOpenEditModal(ev)}
                      style={{
                        padding: 'var(--space-1) var(--space-2)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'transparent',
                        color: 'var(--color-text-secondary)',
                        fontSize: 'var(--text-small)',
                        cursor: 'pointer',
                      }}
                    >
                      Edit
                    </button>

                    <button
                      onClick={() => handleToggleEvent(ev.id, ev.title)}
                      style={{
                        padding: 'var(--space-1) var(--space-2)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'transparent',
                        color: ev.enabled ? 'var(--color-live)' : 'var(--color-text-muted)',
                        fontSize: 'var(--text-micro)',
                        cursor: 'pointer',
                      }}
                    >
                      {ev.enabled ? 'ACTIVE' : 'MUTED'}
                    </button>

                    <button
                      onClick={() => handleDeleteEvent(ev.id, ev.title)}
                      style={{
                        padding: 'var(--space-1) var(--space-2)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'transparent',
                        color: 'var(--color-error)',
                        fontSize: 'var(--text-small)',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Timetable View 2: Weekly Broadcast Matrix Grid */}
        {viewMode === 'grid' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 'var(--space-3)',
              backgroundColor: 'var(--color-surface)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
            }}
          >
            {[1, 2, 3, 4, 5, 6, 0].map((dayIndex) => {
              const dayEvents = events
                .filter((e) => e.daysOfWeek.includes(dayIndex))
                .sort((a, b) => a.startTime.localeCompare(b.startTime));

              return (
                <div key={dayIndex} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <div
                    style={{
                      padding: 'var(--space-2)',
                      backgroundColor: 'var(--color-surface-elevated)',
                      borderRadius: 'var(--radius-sm)',
                      fontWeight: 700,
                      fontSize: 'var(--text-small)',
                      textAlign: 'center',
                      color: snapshot.activeDay === dayIndex ? 'var(--color-live)' : 'var(--color-text-primary)',
                      border: snapshot.activeDay === dayIndex ? '1px solid var(--color-live)' : '1px solid var(--color-border)',
                    }}
                  >
                    {FULL_DAY_NAMES[dayIndex]}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minHeight: 300 }}>
                    {dayEvents.map((ev) => (
                      <div
                        key={ev.id}
                        onClick={() => handleOpenEditModal(ev)}
                        style={{
                          padding: 'var(--space-2)',
                          backgroundColor: 'var(--color-bg)',
                          border: '1px solid var(--color-border)',
                          borderLeft: `3px solid ${ev.color}`,
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--text-micro)',
                          cursor: 'pointer',
                          opacity: ev.enabled ? 1 : 0.5,
                        }}
                      >
                        <div style={{ fontFamily: 'monospace', color: 'var(--color-live)', fontWeight: 600 }}>
                          {ev.startTime} - {ev.endTime}
                        </div>
                        <div style={{ fontWeight: 600, marginTop: '2px', color: 'var(--color-text-primary)' }}>
                          {ev.title}
                        </div>
                        <div style={{ color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                          {ev.host}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Program Add / Edit Modal */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 540,
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 'var(--text-h2)' }}>
              {editingId ? 'Edit Scheduled Program' : 'Schedule New Program'}
            </h3>

            <form onSubmit={handleSaveModal} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                  PROGRAM TITLE
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. Kajian Subuh: Kitab Tauhid"
                  style={{
                    width: '100%',
                    padding: 'var(--space-2)',
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-primary)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <div>
                  <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                    HOST / PRESENTER
                  </label>
                  <input
                    type="text"
                    value={formHost}
                    onChange={(e) => setFormHost(e.target.value)}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-primary)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                    CATEGORY
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as ScheduleCategory)}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-primary)',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="LIVE_TALK">Live Talk / Lecture</option>
                    <option value="NEWS_BULLETIN">News Bulletin</option>
                    <option value="MUSIC_ROTATION">Music / Recitation Rotation</option>
                    <option value="STATION_ID">Station ID / Sweeper</option>
                    <option value="AUTOMATED_PLAYLIST">Automated Playlist</option>
                  </select>
                </div>
              </div>

              {/* Start & End Time */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <div>
                  <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                    START TIME (24H)
                  </label>
                  <input
                    type="time"
                    value={formStartTime}
                    onChange={(e) => setFormStartTime(e.target.value)}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-primary)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                    END TIME (24H)
                  </label>
                  <input
                    type="time"
                    value={formEndTime}
                    onChange={(e) => setFormEndTime(e.target.value)}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      backgroundColor: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-primary)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Days Selector */}
              <div>
                <label style={{ fontSize: 'var(--text-micro)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                  RECURRING DAYS
                </label>
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                  {DAY_NAMES.map((name, idx) => (
                    <button
                      type="button"
                      key={name}
                      onClick={() => handleToggleDay(idx)}
                      style={{
                        flex: 1,
                        padding: 'var(--space-2) 0',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border)',
                        backgroundColor: formDays.includes(idx) ? 'var(--color-live)' : 'var(--color-bg)',
                        color: formDays.includes(idx) ? 'var(--color-live-text)' : 'var(--color-text-secondary)',
                        fontWeight: formDays.includes(idx) ? 700 : 400,
                        cursor: 'pointer',
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Automation Flags */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-small)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formAutoMeta}
                    onChange={(e) => setFormAutoMeta(e.target.checked)}
                  />
                  Automatically push program title and host to broadcast metadata
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-small)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formAutoRecord}
                    onChange={(e) => setFormAutoRecord(e.target.checked)}
                  />
                  Automatically start master session recording when program goes on air
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: 'var(--space-2) var(--space-4)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: 'var(--space-2) var(--space-4)',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    backgroundColor: 'var(--color-live)',
                    color: 'var(--color-live-text)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
