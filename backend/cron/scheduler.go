package cron

import (
	"fmt"
	"sync"
	"time"

	"github.com/go-co-op/gocron/v2"

	mqttclient "mqtt-dashboard/mqtt"
)

type JobInfo struct {
	PanelID    string    `json:"panel_id"`
	CronExpr   string    `json:"cron_expr"`
	Topic      string    `json:"topic"`
	Payload    string    `json:"payload"`
	Enabled    bool      `json:"enabled"`
	NextRun    time.Time `json:"next_run"`
	gocronUUID string
}

type Scheduler struct {
	mu   sync.Mutex
	s    gocron.Scheduler
	jobs map[string]*JobInfo // panelID → JobInfo
	mqtt *mqttclient.MQTTManager
}

func NewScheduler(mqtt *mqttclient.MQTTManager) (*Scheduler, error) {
	s, err := gocron.NewScheduler()
	if err != nil {
		return nil, err
	}
	return &Scheduler{
		s:    s,
		jobs: make(map[string]*JobInfo),
		mqtt: mqtt,
	}, nil
}

func (sc *Scheduler) Start() {
	sc.s.Start()
}

func (sc *Scheduler) Stop() {
	sc.s.Shutdown() //nolint
}

func (sc *Scheduler) AddJob(panelID, cronExpr, topic, payload string, enabled bool) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	// Remove existing job for this panel if any
	if info, ok := sc.jobs[panelID]; ok {
		sc.s.RemoveByTags(panelID) //nolint
		delete(sc.jobs, info.PanelID)
	}

	info := &JobInfo{
		PanelID:  panelID,
		CronExpr: cronExpr,
		Topic:    topic,
		Payload:  payload,
		Enabled:  enabled,
	}

	if enabled {
		job, err := sc.s.NewJob(
			gocron.CronJob(cronExpr, false),
			gocron.NewTask(func() {
				sc.mqtt.Publish(topic, []byte(payload)) //nolint
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
	return sc.AddJob(panelID, info.CronExpr, info.Topic, info.Payload, enabled)
}

func (sc *Scheduler) GetJob(panelID string) (*JobInfo, bool) {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	info, ok := sc.jobs[panelID]
	if !ok {
		return nil, false
	}
	// Refresh next run
	jobs := sc.s.Jobs()
	for _, j := range jobs {
		for _, tag := range j.Tags() {
			if tag == panelID {
				nextRun, _ := j.NextRun()
				info.NextRun = nextRun
			}
		}
	}
	return info, true
}
