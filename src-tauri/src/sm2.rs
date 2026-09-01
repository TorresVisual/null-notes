use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};

/// A card's SM-2 scheduling state, parsed from (or about to be written to)
/// its `<!-- sr due=... ease=... interval=... reps=... -->` comment line. A
/// card with no comment yet is `Default` — new, due immediately.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CardState {
    pub ease: f64,
    pub interval: i64,
    pub reps: i64,
}

impl Default for CardState {
    fn default() -> Self {
        CardState {
            ease: 2.5,
            interval: 0,
            reps: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[repr(i32)]
pub enum Grade {
    Again = 0,
    Hard = 1,
    Good = 2,
    Easy = 3,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scheduled {
    pub ease: f64,
    pub interval: i64,
    pub reps: i64,
    pub due: NaiveDate,
}

impl Grade {
    pub fn as_str(self) -> &'static str {
        match self {
            Grade::Again => "again",
            Grade::Hard => "hard",
            Grade::Good => "good",
            Grade::Easy => "easy",
        }
    }

    fn from_rung(rung: i32) -> Grade {
        match rung {
            0 => Grade::Again,
            1 => Grade::Hard,
            2 => Grade::Good,
            _ => Grade::Easy,
        }
    }
}

const MIN_EASE: f64 = 1.3;

/// SM-2 with four-button grading. A brand-new card (`CardState::default()`,
/// `reps: 0`) always lands in each branch's `reps == 1` case on its first
/// grading, regardless of which button was pressed — there is no history yet
/// to weight differently.
pub fn next_state(state: CardState, grade: Grade, today: NaiveDate) -> Scheduled {
    match grade {
        Grade::Again => Scheduled {
            ease: (state.ease - 0.20).max(MIN_EASE),
            interval: 1,
            reps: 0,
            due: today + Duration::days(1),
        },
        Grade::Hard => {
            let interval = ((state.interval as f64) * 1.2).round().max(1.0) as i64;
            Scheduled {
                ease: (state.ease - 0.15).max(MIN_EASE),
                interval,
                reps: state.reps + 1,
                due: today + Duration::days(interval),
            }
        }
        Grade::Good => {
            let reps = state.reps + 1;
            let interval = if reps == 1 {
                1
            } else if reps == 2 {
                6
            } else {
                ((state.interval as f64) * state.ease).round() as i64
            };
            Scheduled {
                ease: state.ease,
                interval,
                reps,
                due: today + Duration::days(interval),
            }
        }
        Grade::Easy => {
            let reps = state.reps + 1;
            let base = if reps == 1 {
                1.0
            } else if reps == 2 {
                6.0
            } else {
                (state.interval as f64) * state.ease
            };
            let interval = (base * 1.3).round().max(1.0) as i64;
            Scheduled {
                ease: state.ease + 0.15,
                interval,
                reps,
                due: today + Duration::days(interval),
            }
        }
    }
}

/// MC grading moves one rung of the four SM-2 grades per attempt instead of
/// asking the reviewer to self-assess. A card with no prior grade starts at
/// the `Hard` baseline, so a first correct pick lands on `Good` and a first
/// miss lands on `Again` — matching what a manual first grade would produce
/// today.
pub fn mc_auto_grade(last_grade: Option<Grade>, correct: bool) -> Grade {
    let rung = last_grade.map_or(1, |g| g as i32); // Hard=1 baseline
    let next = if correct { rung + 1 } else { rung - 1 };
    Grade::from_rung(next.clamp(0, 3))
}

/// Today's date as an ISO `YYYY-MM-DD` string — day granularity throughout,
/// since reviews are a once-or-twice-a-day activity, not something needing
/// sub-day scheduling.
pub fn today() -> String {
    chrono::Utc::now().date_naive().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn test_again_resets_reps_and_shortens_interval() {
        let state = CardState {
            ease: 2.5,
            interval: 10,
            reps: 3,
        };
        let out = next_state(state, Grade::Again, date("2026-08-20"));
        assert_eq!(out.reps, 0);
        assert_eq!(out.interval, 1);
        assert_eq!(out.due, date("2026-08-21"));
        assert!((out.ease - 2.30).abs() < 1e-9);
    }

    #[test]
    fn test_again_never_drops_ease_below_floor() {
        let state = CardState {
            ease: 1.35,
            interval: 1,
            reps: 0,
        };
        let out = next_state(state, Grade::Again, date("2026-08-20"));
        assert!((out.ease - MIN_EASE).abs() < 1e-9);
    }

    #[test]
    fn test_good_on_a_new_card_sets_one_day_interval() {
        let out = next_state(CardState::default(), Grade::Good, date("2026-08-20"));
        assert_eq!(out.reps, 1);
        assert_eq!(out.interval, 1);
        assert_eq!(out.due, date("2026-08-21"));
        assert!((out.ease - 2.5).abs() < 1e-9);
    }

    #[test]
    fn test_good_on_second_review_sets_six_day_interval() {
        let state = CardState {
            ease: 2.5,
            interval: 1,
            reps: 1,
        };
        let out = next_state(state, Grade::Good, date("2026-08-20"));
        assert_eq!(out.reps, 2);
        assert_eq!(out.interval, 6);
    }

    #[test]
    fn test_good_on_third_review_multiplies_by_ease() {
        let state = CardState {
            ease: 2.5,
            interval: 6,
            reps: 2,
        };
        let out = next_state(state, Grade::Good, date("2026-08-20"));
        assert_eq!(out.reps, 3);
        assert_eq!(out.interval, 15); // round(6 * 2.5)
    }

    #[test]
    fn test_hard_shrinks_ease_and_grows_slowly() {
        let state = CardState {
            ease: 2.5,
            interval: 6,
            reps: 2,
        };
        let out = next_state(state, Grade::Hard, date("2026-08-20"));
        assert_eq!(out.interval, 7); // round(6 * 1.2)
        assert!((out.ease - 2.35).abs() < 1e-9);
    }

    #[test]
    fn test_hard_on_a_new_card_still_yields_at_least_one_day() {
        let out = next_state(CardState::default(), Grade::Hard, date("2026-08-20"));
        assert_eq!(out.interval, 1);
    }

    #[test]
    fn test_easy_grows_ease_and_applies_bonus() {
        let state = CardState {
            ease: 2.5,
            interval: 6,
            reps: 2,
        };
        let out = next_state(state, Grade::Easy, date("2026-08-20"));
        assert_eq!(out.interval, 20); // round(6 * 2.5 * 1.3)
        assert!((out.ease - 2.65).abs() < 1e-9);
    }

    #[test]
    fn test_easy_on_a_new_card_uses_one_day_base() {
        let out = next_state(CardState::default(), Grade::Easy, date("2026-08-20"));
        assert_eq!(out.reps, 1);
        assert_eq!(out.interval, 1); // round(1 * 1.3) = 1
    }

    #[test]
    fn test_today_returns_iso_date_format() {
        let t = today();
        assert_eq!(t.len(), 10);
        assert_eq!(t.chars().nth(4), Some('-'));
        assert_eq!(t.chars().nth(7), Some('-'));
    }

    #[test]
    fn test_mc_auto_grade_new_card_correct_lands_on_good() {
        assert_eq!(mc_auto_grade(None, true), Grade::Good);
    }

    #[test]
    fn test_mc_auto_grade_new_card_incorrect_lands_on_again() {
        assert_eq!(mc_auto_grade(None, false), Grade::Again);
    }

    #[test]
    fn test_mc_auto_grade_moves_one_rung_up_on_correct() {
        assert_eq!(mc_auto_grade(Some(Grade::Good), true), Grade::Easy);
    }

    #[test]
    fn test_mc_auto_grade_moves_one_rung_down_on_incorrect() {
        assert_eq!(mc_auto_grade(Some(Grade::Good), false), Grade::Hard);
    }

    #[test]
    fn test_mc_auto_grade_caps_at_easy() {
        assert_eq!(mc_auto_grade(Some(Grade::Easy), true), Grade::Easy);
    }

    #[test]
    fn test_mc_auto_grade_floors_at_again() {
        assert_eq!(mc_auto_grade(Some(Grade::Again), false), Grade::Again);
    }

    #[test]
    fn test_grade_as_str_round_trips_the_serde_names() {
        assert_eq!(Grade::Again.as_str(), "again");
        assert_eq!(Grade::Hard.as_str(), "hard");
        assert_eq!(Grade::Good.as_str(), "good");
        assert_eq!(Grade::Easy.as_str(), "easy");
    }
}
