package cron

import (
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/go-co-op/gocron/v2"
)

type JobInfo struct {
	PanelID    string    `json:"panel_id"`
	BrokerID   string    `json:"broker_id"`
	CronExpr   string    `json:"cron_expr"`
	Topic      string    `json:"topic"`
	Payload    string    `json:"payload"`
	QoS        byte      `json:"qos"`
	Retain     bool      `json:"retain"`
	Enabled    bool      `json:"enabled"`
	NextRun    time.Time `json:"next_run"`
	PrevRun    time.Time `json:"prev_run,omitempty"`
	gocronUUID string
}

type Scheduler struct {
	mu       sync.Mutex
	s        gocron.Scheduler
	jobs     map[string]*JobInfo // panelID → JobInfo
	registry BrokerPublisher
}

func NewScheduler(registry BrokerPublisher) (*Scheduler, error) {
	s, err := gocron.NewScheduler()
	if err != nil {
		return nil, err
	}
	return &Scheduler{
		s:        s,
		jobs:     make(map[string]*JobInfo),
		registry: registry,
	}, nil
}

func (sc *Scheduler) Start() {
	sc.s.Start()
}

func (sc *Scheduler) Stop() {
	sc.s.Shutdown() //nolint
}

// ValidateCronExpr reports whether expr is a schedulable 5-field cron
// expression, without registering anything. It is exported so handlers can
// reject bad input before any state is mutated.
func ValidateCronExpr(cronExpr string) error {
	s, err := gocron.NewScheduler()
	if err != nil {
		return err
	}
	defer s.Shutdown() //nolint
	if _, err := s.NewJob(gocron.CronJob(cronExpr, false), gocron.NewTask(func() {})); err != nil {
		return fmt.Errorf("invalid cron expression %q: %w", cronExpr, err)
	}
	return nil
}

func (sc *Scheduler) AddJob(panelID, brokerID, cronExpr, topic, payload string, qos byte, retain bool, enabled bool) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	slog.Info("cron add job", "panel_id", panelID, "cron", cronExpr, "topic", topic, "enabled", enabled)

	// Validate up front so an invalid expression never mutates state,
	// regardless of whether the job is enabled.
	if err := ValidateCronExpr(cronExpr); err != nil {
		return err
	}
	if strings.Contains(topic, "+") || strings.Contains(topic, "#") {
		return fmt.Errorf("wildcards (+ or #) are not supported for cron publishing")
	}

	// Remove existing job for this panel if any
	if info, ok := sc.jobs[panelID]; ok {
		sc.s.RemoveByTags(panelID) //nolint
		delete(sc.jobs, info.PanelID)
	}

	info := &JobInfo{
		PanelID:  panelID,
		BrokerID: brokerID,
		CronExpr: cronExpr,
		Topic:    topic,
		Payload:  payload,
		QoS:      qos,
		Retain:   retain,
		Enabled:  enabled,
	}

	if enabled {
		bid := brokerID
		job, err := sc.s.NewJob(
			gocron.CronJob(cronExpr, false),
			gocron.NewTask(func() {
				bID := bid
				if bID == "" {
					bID = sc.registry.DefaultBrokerID()
				}
				for _, t := range strings.Split(topic, ",") {
					t = strings.TrimSpace(t)
					if t != "" {
						sc.registry.Publish(bID, t, qos, retain, []byte(payload)) //nolint
					}
				}
			}),
			gocron.WithTags(panelID),
		)
		if err != nil {
			return fmt.Errorf("schedule job: %w", err)
		}
		info.gocronUUID = job.ID().String()
		nextRun, _ := job.NextRun()
		info.NextRun = nextRun
	}

	sc.jobs[panelID] = info
	return nil
}

func (sc *Scheduler) RemoveJob(panelID string) {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	slog.Info("cron remove job", "panel_id", panelID)
	sc.s.RemoveByTags(panelID) //nolint
	delete(sc.jobs, panelID)
}

func (sc *Scheduler) ToggleJob(panelID string, enabled bool) error {
	sc.mu.Lock()
	info, ok := sc.jobs[panelID]
	sc.mu.Unlock()
	if !ok {
		return fmt.Errorf("job %q not found", panelID)
	}
	return sc.AddJob(panelID, info.BrokerID, info.CronExpr, info.Topic, info.Payload, info.QoS, info.Retain, enabled)
}

func (sc *Scheduler) GetJob(panelID string) (*JobInfo, bool) {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	info, ok := sc.jobs[panelID]
	if !ok {
		return nil, false
	}
	// Refresh next run and last run
	jobs := sc.s.Jobs()
	for _, j := range jobs {
		for _, tag := range j.Tags() {
			if tag == panelID {
				nextRun, _ := j.NextRun()
				info.NextRun = nextRun
				lastRun, _ := j.LastRun()
				info.PrevRun = lastRun
			}
		}
	}
	return info, true
}

// StartPruningJob registers a cron job that runs every 30 minutes and deletes
// mqtt_history records older than the configured retention window.
func (sc *Scheduler) StartPruningJob(db *sql.DB) error {
	_, err := sc.s.NewJob(
		gocron.CronJob("*/30 * * * *", false),
		gocron.NewTask(func() {
			slog.Debug("running history pruning job")
			var retentionHours int
			row := db.QueryRow(`SELECT retention_period_hours FROM app_settings WHERE id = 1`)
			if err := row.Scan(&retentionHours); err != nil || retentionHours < 24 {
				retentionHours = 24
			}
			db.Exec(`DELETE FROM mqtt_history WHERE timestamp < DATETIME('now', '-' || ? || ' hours')`, retentionHours) //nolint
		}),
		gocron.JobOption(gocron.WithStartImmediately()),
		gocron.WithTags("pruning"),
	)
	return err
}
