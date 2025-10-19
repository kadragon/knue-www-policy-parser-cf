# Cron Trigger Timing Specification

## Requirements
- **Target Timezone:** KST (Korea Standard Time = UTC + 9)
- **Target Time:** 01:00 (new day, early morning)
- **Frequency:** Daily

## Timezone Conversion

### KST to UTC
```
KST 01:00 (e.g., Oct 19, 2025 01:00 KST)
= UTC 16:00 (Oct 18, 2025 16:00 UTC)

Calculation: 01:00 - 09:00 = -08:00 → previous day 16:00 UTC
```

### UTC Cron Expression
```
Cron Format: minute hour day month dayOfWeek
Standard:    minute hour day month *

KST 01:00 Daily
↓
UTC 16:00 Daily
↓
Cron: 0 16 * * *
```

| Field | Value | Meaning |
|-------|-------|---------|
| Minute | 0 | Top of hour |
| Hour | 16 | 16:00 UTC = 01:00 KST (next day) |
| Day | * | Every day |
| Month | * | Every month |
| DayOfWeek | * | Every day of week |

---

## Implementation

### Wrangler Configuration
Update `wrangler.jsonc`:

```jsonc
{
  // ... existing config ...
  "triggers": {
    "crons": ["0 16 * * *"]
  },
  // ... rest of config ...
}
```

### Alternative: Named Schedule (Optional)
If Wrangler supports named schedules, document as:

```jsonc
{
  "triggers": {
    "crons": [
      {
        "name": "daily-policy-sync",
        "schedule": "0 16 * * *",
        "timezone": "UTC",
        "description": "Daily policy sync at 01:00 KST (16:00 UTC)"
      }
    ]
  }
}
```

---

## Verification

### Pre-deployment Check
1. Confirm Cron syntax: `0 16 * * *`
   - Valid for Cloudflare Workers
   - Runs every day at 16:00 UTC

2. Test locally:
   ```bash
   wrangler dev --test-scheduled
   ```
   This allows manual trigger to test the scheduled handler.

### Post-deployment Check
1. Monitor CloudFlare Logs for scheduled triggers
2. Verify execution timestamp matches 16:00 UTC (01:00 KST next day)
3. Check worker output for successful or failed sync runs

---

## Daylight Saving Time (DST) Considerations

**Important:** KST does **NOT** observe daylight saving time. It remains UTC+9 year-round.

- No DST adjustment needed
- Cron `0 16 * * *` is consistent year-round
- No changes required between seasons

---

## References

- [Cloudflare Workers Cron Triggers Documentation](https://developers.cloudflare.com/workers/platform/triggers/crons/)
- [Cron Expression Syntax](https://crontab.guru/)
- Korea Standard Time: [UTC+9, no DST](https://en.wikipedia.org/wiki/Korea_Standard_Time)
