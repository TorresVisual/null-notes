use crate::sm2::{Grade, Scheduled};
use chrono::{Duration, NaiveDate};

/// FSRS-5 default parameters; no optimizer in v1.
const W: [f64; 19] = [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
    1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];
const DECAY: f64 = -0.5;
const FACTOR: f64 = 19.0 / 81.0;

pub const DEFAULT_RETENTION: f64 = 0.9;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FsrsState {
    pub stability: f64,
    pub difficulty: f64,
}

/// Carries a card's SM-2 state over: stability is the interval it was last
/// given (by definition the days until recall drops to the target
/// retention), and difficulty is ease mapped linearly from 1.3 → 10 to
/// 2.5 → 5. Due dates are untouched, so switching schedulers moves nothing.
pub fn from_sm2(ease: f64, interval: i64) -> FsrsState {
    FsrsState {
        stability: (interval as f64).max(1.0),
        difficulty: (10.0 - (ease - 1.3) / 1.2 * 5.0).clamp(1.0, 10.0),
    }
}

fn rating(grade: Grade) -> f64 {
    grade as i32 as f64 + 1.0
}

fn initial_difficulty(rating: f64) -> f64 {
    (W[4] - (W[5] * (rating - 1.0)).exp() + 1.0).clamp(1.0, 10.0)
}

fn retrievability(elapsed_days: i64, stability: f64) -> f64 {
    (1.0 + FACTOR * elapsed_days.max(0) as f64 / stability).powf(DECAY)
}

fn interval_days(stability: f64, retention: f64) -> i64 {
    let days = stability / FACTOR * (retention.powf(1.0 / DECAY) - 1.0);
    days.round().max(1.0) as i64
}

/// `previous` is `None` for a card never reviewed; `elapsed_days` is the
/// time since its last review, so a late review earns more stability than
/// an on-time one.
pub fn next_state(
    previous: Option<FsrsState>,
    elapsed_days: i64,
    grade: Grade,
    retention: f64,
    today: NaiveDate,
) -> (FsrsState, Scheduled) {
    let g = rating(grade);
    let next = match previous {
        None => FsrsState {
            stability: W[g as usize - 1],
            difficulty: initial_difficulty(g),
        },
        Some(FsrsState {
            stability: s,
            difficulty: d,
        }) => {
            let r = retrievability(elapsed_days, s);
            let damped = d + -W[6] * (g - 3.0) * (10.0 - d) / 9.0;
            let difficulty =
                (W[7] * initial_difficulty(4.0) + (1.0 - W[7]) * damped).clamp(1.0, 10.0);
            let stability = if grade == Grade::Again {
                (W[11] * d.powf(-W[12]) * ((s + 1.0).powf(W[13]) - 1.0) * (W[14] * (1.0 - r)).exp())
                    .min(s)
            } else {
                let hard = if grade == Grade::Hard { W[15] } else { 1.0 };
                let easy = if grade == Grade::Easy { W[16] } else { 1.0 };
                s * (1.0
                    + W[8].exp()
                        * (11.0 - d)
                        * s.powf(-W[9])
                        * ((W[10] * (1.0 - r)).exp() - 1.0)
                        * hard
                        * easy)
            };
            FsrsState {
                stability: stability.max(0.01),
                difficulty,
            }
        }
    };
    let interval = interval_days(next.stability, retention);
    let scheduled = Scheduled {
        ease: 0.0,
        interval,
        reps: 0,
        due: today + Duration::days(interval),
    };
    (next, scheduled)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 4).unwrap()
    }

    #[test]
    fn test_first_review_uses_initial_stability_per_grade() {
        let (s, out) = next_state(None, 0, Grade::Good, 0.9, today());
        assert!((s.stability - 3.173).abs() < 1e-9);
        assert_eq!(out.interval, 3);
        let (s, _) = next_state(None, 0, Grade::Again, 0.9, today());
        assert!((s.stability - 0.40255).abs() < 1e-9);
    }

    #[test]
    fn test_interval_equals_stability_at_ninety_percent_retention() {
        assert_eq!(interval_days(10.0, 0.9), 10);
        assert!(interval_days(10.0, 0.95) < 10);
        assert!(interval_days(10.0, 0.8) > 10);
    }

    #[test]
    fn test_on_time_good_review_grows_stability() {
        let prev = FsrsState {
            stability: 10.0,
            difficulty: 5.0,
        };
        let (s, out) = next_state(Some(prev), 10, Grade::Good, 0.9, today());
        assert!(s.stability > 10.0);
        assert_eq!(out.due, today() + Duration::days(out.interval));
    }

    #[test]
    fn test_late_review_gains_more_stability_than_on_time() {
        let prev = FsrsState {
            stability: 10.0,
            difficulty: 5.0,
        };
        let (on_time, _) = next_state(Some(prev), 10, Grade::Good, 0.9, today());
        let (late, _) = next_state(Some(prev), 40, Grade::Good, 0.9, today());
        assert!(late.stability > on_time.stability);
    }

    #[test]
    fn test_again_drops_stability_and_raises_difficulty() {
        let prev = FsrsState {
            stability: 30.0,
            difficulty: 5.0,
        };
        let (s, _) = next_state(Some(prev), 30, Grade::Again, 0.9, today());
        assert!(s.stability < 30.0);
        assert!(s.difficulty > 5.0);
    }

    #[test]
    fn test_grades_order_intervals() {
        let prev = FsrsState {
            stability: 10.0,
            difficulty: 5.0,
        };
        let iv = |g| next_state(Some(prev), 10, g, 0.9, today()).1.interval;
        assert!(iv(Grade::Again) < iv(Grade::Hard));
        assert!(iv(Grade::Hard) < iv(Grade::Good));
        assert!(iv(Grade::Good) < iv(Grade::Easy));
    }

    #[test]
    fn test_sm2_migration_keeps_interval_as_stability() {
        let s = from_sm2(2.5, 15);
        assert_eq!(s.stability, 15.0);
        assert!((s.difficulty - 5.0).abs() < 1e-9);
        assert_eq!(from_sm2(1.3, 0).difficulty, 10.0);
        assert_eq!(from_sm2(1.3, 0).stability, 1.0);
    }
}
