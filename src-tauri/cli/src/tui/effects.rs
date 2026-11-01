use crate::client::{self, ClientError, Env};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;

pub type Call = Box<dyn Fn(&str, Value) -> Result<Value, ClientError> + Send + 'static>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Slot {
    Notes,
    Preview,
    Backlinks,
    Search,
    Tasks,
    TaskToggle,
    Cards,
    CardWrite,
    Tags,
    TagNotes,
    Trash,
    TrashRestore,
    Capture,
    Keepalive,
}

impl Slot {
    pub fn is_write(self) -> bool {
        matches!(
            self,
            Slot::TaskToggle
                | Slot::CardWrite
                | Slot::TrashRestore
                | Slot::Capture
                | Slot::Keepalive
        )
    }
}

#[derive(Debug, Clone)]
pub struct Job {
    pub slot: Slot,
    pub command: &'static str,
    pub args: Value,
}

#[derive(Debug)]
pub struct Reply {
    pub slot: Slot,
    pub id: u64,
    pub command: &'static str,
    pub args: Value,
    pub result: Result<Value, ClientError>,
}

#[derive(Debug)]
pub struct Worker {
    jobs: mpsc::Sender<(u64, Job)>,
    latest: HashMap<Slot, u64>,
    next_id: u64,
}

impl Worker {
    // ponytail: one worker, so a slow request delays the next; a pool if that ever shows.
    pub fn spawn(call: Call, replies: mpsc::Sender<Reply>) -> Worker {
        let (jobs, queue) = mpsc::channel::<(u64, Job)>();
        thread::spawn(move || {
            for (id, job) in queue {
                let result = call(job.command, job.args.clone());
                let reply = Reply {
                    slot: job.slot,
                    id,
                    command: job.command,
                    args: job.args,
                    result,
                };
                if replies.send(reply).is_err() {
                    break;
                }
            }
        });
        Worker {
            jobs,
            latest: HashMap::new(),
            next_id: 0,
        }
    }

    pub fn submit(&mut self, job: Job) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        self.latest.insert(job.slot, id);
        let _ = self.jobs.send((id, job));
        id
    }

    pub fn is_current(&self, reply: &Reply) -> bool {
        reply.slot.is_write() || self.latest.get(&reply.slot) == Some(&reply.id)
    }
}

pub fn pipe_call(env: Env, workspace: PathBuf) -> Call {
    Box::new(move |command, args| client::request_with(&env, command, Some(&workspace), args))
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ErrorBody, ErrorCode};
    use serde_json::json;
    use std::time::Duration;

    fn echo() -> Call {
        Box::new(|command, args| Ok(json!({ "command": command, "args": args })))
    }

    fn job(slot: Slot, n: i64) -> Job {
        Job {
            slot,
            command: "note.read",
            args: json!({ "n": n }),
        }
    }

    fn recv(rx: &mpsc::Receiver<Reply>) -> Reply {
        rx.recv_timeout(Duration::from_secs(5)).expect("a reply")
    }

    #[test]
    fn replies_carry_slot_command_args_and_id() {
        let (tx, rx) = mpsc::channel();
        let mut worker = Worker::spawn(echo(), tx);
        let id = worker.submit(job(Slot::Preview, 1));
        let reply = recv(&rx);
        assert_eq!(reply.slot, Slot::Preview);
        assert_eq!(reply.command, "note.read");
        assert_eq!(reply.args, json!({ "n": 1 }));
        assert_eq!(reply.id, id);
        assert_eq!(reply.result.unwrap()["command"], "note.read");
    }

    #[test]
    fn a_newer_submit_makes_the_older_reply_stale() {
        let (tx, rx) = mpsc::channel();
        let mut worker = Worker::spawn(echo(), tx);
        worker.submit(job(Slot::Search, 1));
        worker.submit(job(Slot::Search, 2));
        let (first, second) = (recv(&rx), recv(&rx));
        assert!(!worker.is_current(&first));
        assert!(worker.is_current(&second));
    }

    #[test]
    fn write_slots_are_never_stale() {
        let (tx, rx) = mpsc::channel();
        let mut worker = Worker::spawn(echo(), tx);
        worker.submit(job(Slot::TaskToggle, 1));
        worker.submit(job(Slot::TaskToggle, 2));
        assert!(worker.is_current(&recv(&rx)));
        assert!(worker.is_current(&recv(&rx)));
    }

    #[test]
    fn slots_are_independent() {
        let (tx, rx) = mpsc::channel();
        let mut worker = Worker::spawn(echo(), tx);
        worker.submit(job(Slot::Preview, 1));
        worker.submit(job(Slot::Backlinks, 1));
        assert!(worker.is_current(&recv(&rx)));
        assert!(worker.is_current(&recv(&rx)));
    }

    #[test]
    fn errors_pass_through_unchanged() {
        let (tx, rx) = mpsc::channel();
        let call: Call = Box::new(|_, _| {
            Err(ClientError::Rejected(ErrorBody {
                code: ErrorCode::DirtyBuffer,
                message: "dirty".into(),
            }))
        });
        let mut worker = Worker::spawn(call, tx);
        worker.submit(job(Slot::TaskToggle, 1));
        match recv(&rx).result {
            Err(ClientError::Rejected(body)) => {
                assert_eq!(body.code, ErrorCode::DirtyBuffer);
                assert_eq!(body.message, "dirty");
            }
            other => panic!("unexpected {other:?}"),
        }
    }
}
