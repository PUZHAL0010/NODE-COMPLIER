import { AlertService } from '../../server/services/alertService';

describe('Real-Time AlertService', () => {
  const alertService = AlertService.getInstance();

  beforeEach(() => {
    alertService.clearAlerts();
  });

  it('records critical crash alert and retains in recent buffer', () => {
    const alert = alertService.recordCrash('job-test-1', 'trace-test-1', 'Process exited with code 1', {
      exitCode: 1,
    });

    expect(alert.alertId).toBeDefined();
    expect(alert.severity).toBe('CRITICAL');
    expect(alert.category).toBe('CRASH');
    expect(alert.jobId).toBe('job-test-1');
    expect(alert.message).toContain('Process exited with code 1');

    const recents = alertService.getRecentAlerts(10);
    expect(recents.length).toBe(1);
    expect(recents[0].alertId).toBe(alert.alertId);
  });

  it('notifies subscribers immediately on new alert', (done) => {
    const unsubscribe = alertService.subscribe((alert) => {
      expect(alert.category).toBe('SECURITY');
      expect(alert.severity).toBe('WARNING');
      expect(alert.message).toContain('TCS iON policy');
      unsubscribe();
      done();
    });

    alertService.recordSecurityIncident('TCS_ION_SSRF', 'Metadata IP blocked under TCS iON policy');
  });

  it('records timeout alerts accurately with limit metadata', () => {
    const alert = alertService.recordTimeout('job-timeout-1', 5000, 'trace-timeout');
    expect(alert.severity).toBe('WARNING');
    expect(alert.category).toBe('TIMEOUT');
    expect(alert.details?.timeoutMs).toBe(5000);
  });
});
