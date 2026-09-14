# Mobile `push_notes` (gix wire protocol) Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace `git_mobile.rs`'s `checked_push` stub (currently `anyhow::bail!("push is not yet implemented...")`) with a real implementation that pushes local commits to an HTTPS remote using `gix`'s low-level transport primitives — the one operation `docs/plans/git-mobile-gix.md`'s Task 5 deliberately deferred after confirming `gix` has no porcelain send-pack API at any released version.

**Architecture:** `gix` (any version through at least 0.87.1) exposes no `push()`/`send_pack()` call on `Remote`/`Connection` — confirmed by reading the crate source directly (`gix-0.87.1/src/remote/connection/mod.rs`, `access.rs`; no `pub mod push` anywhere in the crate). But `Connection::transport_mut(&mut self) -> &mut T` **is** public, and `T: Transport` (`gix_transport::client::blocking_io::Transport`) exposes two primitives that are enough to hand-roll the git wire protocol: `handshake(service, extra_parameters)` and `request(write_mode, on_into_read, trace)`. This plan builds `checked_push` on those two calls plus a hand-rolled, non-delta pack writer (`gix_pack::data::output`, already a transitive dependency at `gix-pack 0.74.2` per `Cargo.lock`).

Three self-contained pieces, in dependency order:
1. **Object diff** — which commits/trees/blobs the remote is missing (pure local repo read, no network).
2. **Pack writer** — serialize a set of object ids into valid pack bytes (no network; every object is sent as a full "base" entry, not a delta — simpler and always valid, just less bandwidth-efficient than `git push`'s real delta packs, which is an acceptable tradeoff for a note workspace's typical commit size).
3. **The wire exchange** — handshake for the `receive-pack` service, read the ref advertisement to find the remote's current oid for the target branch, send the ref-update-request + pack, parse `report-status`, map the result onto the existing `PushOutcome` enum (`Pushed`, `NoRemote`, `AuthFailed`, `Rejected` — from `git.rs`, reused as-is here for frontend parity).

**Tech Stack:** Rust, `gix` 0.87.1 + `gix-pack` 0.74.2 + `gix-transport` 0.59.2 (all three already resolved in `Cargo.lock`; the latter two are currently transitive-only and need adding to `[dependencies]` directly since Task 3 imports their types by name).

**Spec:** `docs/specs/mobile-app-design.md` (Mobile git module section); this plan is the direct follow-up to `docs/plans/git-mobile-gix.md`'s Task 5, whose "Deferred, by explicit decision" note names this exact scope.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- **No subprocess spawning in the shipped iOS path.** `gix-transport`'s local file-path backend (`gix-transport-0.59.2/src/client/blocking_io/file.rs`) does spawn `git upload-pack`/`git receive-pack` as a real child process — this plan's own tests use local temp-dir remotes and therefore exercise that path, same as `checked_pull`'s existing tests already do. That's fine: tests run as `cargo test` on a real desktop/CI process, never inside the iOS sandbox. The mobile *runtime* path is HTTPS-only via the `blocking-http-transport-reqwest-rust-tls` feature (already enabled in `Cargo.toml`), which uses `reqwest`, not a subprocess. Do not let the test fixtures' use of local paths become a reason to believe push works the same way on-device — it's a test oracle, not the shipped code path.
- **No delta compression.** Every object goes into the pack as a full base object (`gix_pack::data::output::entry::Kind::Base`). This is simpler, always protocol-valid, and matches this module's existing "correctness over cleverness" posture (`checked_rebase_onto_remote`'s doc comment makes the same tradeoff explicitly for the same reason). Revisit only if push payload size on a real note workspace proves to matter — no note workspace this app targets approaches the object counts where delta packing changes the user-visible experience.
- **`PushOutcome` is reused unchanged** from `git.rs` (`Pushed`, `NoRemote`, `AuthFailed { output: String }`, `Rejected { output: String }`) — no new variant, so the frontend needs no mobile-specific branch, matching every other command in this module.
- **Desktop (`git.rs`) is untouched.** This plan only replaces the body of `git_mobile.rs`'s `checked_push`.
- Every task's tests run via `cargo test --lib commands::git_mobile:: --manifest-path src-tauri/Cargo.toml` — same as the rest of this module's suite.
- `cargo clippy -- -D warnings` and `cargo fmt --check` must stay clean on both the desktop and `aarch64-apple-ios-sim` targets (per `CLAUDE.md`'s Rust Guidelines and the CI workflow `docs/plans/mobile-ios-scaffold.md` set up) before any commit in this plan.

---

### Task 1: Object diff — which objects the remote is missing

**Files:**
- Modify: `src-tauri/src/commands/git_mobile.rs` (new private function + tests, placed near `changed_paths_between`, which it reuses the same tree-walking style as).

**Interfaces:**
- Consumes: nothing from other tasks (this is the first task).
- Produces: `fn objects_missing_from_remote(repo: &gix::Repository, new: gix::ObjectId, old: Option<gix::ObjectId>) -> anyhow::Result<Vec<gix::ObjectId>>` — Task 2's test and Task 3's `checked_push` both call this directly.

- [x] **Step 1: Confirm `gix_traverse::tree::recorder::Entry`'s field name and whether `.files()` includes subtree ids**

`Tree::traverse().breadthfirst.files()` (`gix-0.87.1/src/object/tree/traverse.rs:31`) returns `Vec<gix_traverse::tree::recorder::Entry>`. `gix-traverse` isn't unpacked in the local registry source cache yet (`cargo fetch` hasn't pulled it, even though `Cargo.lock` already resolves it at `0.61.0` as part of `gix`'s existing dependency graph — no `Cargo.toml` change needed to reach it). Before writing Step 3's code, run:

```bash
cd src-tauri
cargo doc --no-deps -p gix-traverse --open
```

(or read `~/.cargo/registry/src/*/gix-traverse-0.61.0/src/tree/recorder.rs` directly once `cargo fetch` has pulled it) and confirm two things against the real source, not this plan's guess:
1. The exact field name on `recorder::Entry` for the object id (this plan assumes `.oid`, following `gix_traverse`'s general naming convention elsewhere — could be `.id`).
2. Whether `Recorder::default()`'s output includes **both** blob and subtree entries, or leaf blobs only. If subtrees are missing, `objects_missing_from_remote` below needs to additionally walk `entry.mode.is_tree()` matches and recurse into them via `repo.find_tree(entry.oid)?.traverse()...` — write that recursive case only if Step 2's test below fails to find the subtree object.

- [x] **Step 2: Write the failing test**

```rust
    #[test]
    fn missing_objects_includes_new_commit_tree_and_blob_but_not_shared_history() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "# A\n", "notes: add a");
        let repo = gix::discover(tmp.path()).unwrap();
        let old = repo.head_id().unwrap().detach();

        commit_file(tmp.path(), "b.md", "# B\n", "notes: add b");
        let repo = gix::discover(tmp.path()).unwrap();
        let new = repo.head_id().unwrap().detach();

        let missing = objects_missing_from_remote(&repo, new, Some(old)).unwrap();

        // The new commit itself, its (new) root tree, and b.md's blob must
        // all be present — three objects, since a.md's blob and the old
        // root tree are already reachable from `old` and must not repeat.
        assert_eq!(missing.len(), 3);
        assert!(missing.contains(&new));
        assert!(!missing.contains(&old));
    }

    #[test]
    fn missing_objects_with_no_old_ref_includes_everything_reachable() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "# A\n", "notes: add a");
        let repo = gix::discover(tmp.path()).unwrap();
        let new = repo.head_id().unwrap().detach();

        let missing = objects_missing_from_remote(&repo, new, None).unwrap();

        // One commit, one root tree, one blob.
        assert_eq!(missing.len(), 3);
    }
```

- [x] **Step 3: Run tests to verify they fail**

Run: `cargo test --lib commands::git_mobile::tests::missing_objects --manifest-path src-tauri/Cargo.toml`
Expected: FAIL with "cannot find function `objects_missing_from_remote`".

- [x] **Step 4: Implement `objects_missing_from_remote`**

```rust
/// Every commit, tree, and blob reachable from `new` that isn't already
/// reachable from `old` — the exact object set a push of `new` onto a
/// remote currently at `old` must send. `old` is `None` when the target
/// branch doesn't exist on the remote yet (first push of a new branch),
/// in which case everything reachable from `new` is missing.
fn objects_missing_from_remote(
    repo: &gix::Repository,
    new: gix::ObjectId,
    old: Option<gix::ObjectId>,
) -> anyhow::Result<Vec<gix::ObjectId>> {
    let mut commit_walk = repo.rev_walk([new]);
    if let Some(old) = old {
        commit_walk = commit_walk.with_hidden([old]);
    }
    let new_commits: Vec<gix::ObjectId> = commit_walk
        .all()?
        .map(|info| info.map(|i| i.id().detach()))
        .collect::<Result<_, _>>()?;

    // Objects already on the remote: everything reachable from `old`'s
    // tree. A blob/tree's hash is identical wherever it's reachable from,
    // so de-duping against this single set (rather than per-commit) is
    // correct and avoids resending unchanged content.
    let mut known = std::collections::HashSet::new();
    if let Some(old) = old {
        let old_tree = repo.find_commit(old)?.tree()?;
        known.insert(old_tree.id);
        for entry in old_tree.traverse().breadthfirst.files()? {
            known.insert(entry.oid);
        }
    }

    let mut missing: Vec<gix::ObjectId> = new_commits.clone();
    for commit_id in &new_commits {
        let tree = repo.find_commit(*commit_id)?.tree()?;
        if known.insert(tree.id) {
            missing.push(tree.id);
        }
        for entry in tree.traverse().breadthfirst.files()? {
            if known.insert(entry.oid) {
                missing.push(entry.oid);
            }
        }
    }

    Ok(missing)
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `cargo test --lib commands::git_mobile::tests::missing_objects --manifest-path src-tauri/Cargo.toml`
Expected: PASS. If Step 1's investigation found `.files()` omits subtree entries, adjust the inner loop to recurse into `entry.mode.is_tree()` matches before this step — do that now, not as a follow-up, since the test above only passes with correct subtree coverage (a `b.md` at the repo root doesn't exercise a subtree, so add a third test with a nested path, e.g. `notes/b.md`, if Step 1 found subtrees need explicit handling, to actually cover that branch).

- [x] **Step 6: Commit**

```bash
git add src-tauri/src/commands/git_mobile.rs
git commit -m "feat(mobile): compute the object set a push needs to send"
```

---

### Task 2: Pack writer — serialize an object set into valid pack bytes

**Files:**
- Modify: `src-tauri/Cargo.toml` — add `gix-pack` as a direct dependency.
- Modify: `src-tauri/src/commands/git_mobile.rs` (new private function + tests).

**Interfaces:**
- Consumes: nothing from Task 1 directly (takes an object id list as a parameter — Task 3 is what chains Task 1's output into this).
- Produces: `fn build_pack_bytes(repo: &gix::Repository, object_ids: &[gix::ObjectId]) -> anyhow::Result<Vec<u8>>` — Task 3's `checked_push` calls this.

- [x] **Step 1: Add `gix-pack` as a direct dependency**

In `src-tauri/Cargo.toml`, pin to the version already resolved transitively (checked against `Cargo.lock`'s existing `gix-pack` entry — do not let `cargo add` pick a different one and duplicate the dependency graph):

```toml
gix-pack = { version = "0.74.2", default-features = false }
gix-object = { version = "0.64.1", default-features = false }
```

(`gix-object` is needed for `gix_object::Data`, the type `repo.objects.try_find` returns and `output::Entry::from_data` consumes — also already resolved transitively, same pinning approach.)

Run `cargo tree -p gix-pack -p gix-object --manifest-path src-tauri/Cargo.toml` afterward and confirm each still resolves to a single version (no `(*)` duplicate-version marker) — if `cargo add`'s chosen version differs from what `gix` itself depends on, Cargo will happily compile two copies, and `output::Entry` from one won't type-match `output::Entry` from the other at Task 3's call site.

- [x] **Step 2: Write the failing test**

The pack format's own header (`PACK`, version, object count) and trailing SHA-1/SHA-256 checksum are enough to sanity-check without a network round-trip; a stronger check hands the bytes to real `git index-pack`, which validates the full format and confirms the objects are actually reconstructable — this project's CI already has `git` available (`docs/plans/mobile-ios-scaffold.md`'s workflow, and every desktop dev machine), same tool `git.rs`'s own tests already shell out to for fixture setup, so using it as a **test oracle** here (not runtime code) doesn't reintroduce the no-subprocess constraint.

```rust
    #[test]
    fn built_pack_is_accepted_by_real_git_index_pack() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "# A\n", "notes: add a");
        let repo = gix::discover(tmp.path()).unwrap();
        let head = repo.head_id().unwrap().detach();

        let object_ids = objects_missing_from_remote(&repo, head, None).unwrap();
        let pack_bytes = build_pack_bytes(&repo, &object_ids).unwrap();

        // A fresh bare repo has no objects of its own — `index-pack` proves
        // the bytes are a well-formed pack purely from their own content.
        let bare = tempfile::tempdir().unwrap();
        assert!(Command::new("git")
            .arg("init")
            .arg("-q")
            .arg("--bare")
            .arg(bare.path())
            .status()
            .unwrap()
            .success());
        let mut child = Command::new("git")
            .arg("-C")
            .arg(bare.path())
            .arg("index-pack")
            .arg("--stdin")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        use std::io::Write as _;
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&pack_bytes)
            .unwrap();
        assert!(child.wait().unwrap().success());
    }
```

- [x] **Step 3: Run test to verify it fails**

Run: `cargo test --lib commands::git_mobile::tests::built_pack_is_accepted --manifest-path src-tauri/Cargo.toml`
Expected: FAIL with "cannot find function `build_pack_bytes`".

- [x] **Step 4: Implement `build_pack_bytes`**

```rust
/// Serializes `object_ids` into a valid, self-contained (non-thin) pack:
/// every object is written as a full base entry, never a delta. Simpler
/// and always protocol-valid, at the cost of the bandwidth savings a real
/// delta pack would get — see this plan's Global Constraints.
fn build_pack_bytes(
    repo: &gix::Repository,
    object_ids: &[gix::ObjectId],
) -> anyhow::Result<Vec<u8>> {
    use gix_pack::data::output;

    let mut entries = Vec::with_capacity(object_ids.len());
    let mut buf = Vec::new();
    for id in object_ids {
        let Some(data) = gix_object::Find::try_find(&repo.objects, id, &mut buf)? else {
            anyhow::bail!("object {id} referenced for push is missing from the local store");
        };
        let count = output::Count::from_data(*id, None);
        entries.push(output::Entry::from_data(&count, &data, gix_zlib::Compression::default())?);
    }
    let num_entries = entries.len() as u32;

    let mut pack_bytes = Vec::new();
    let mut writer = output::bytes::FromEntriesIter::new(
        std::iter::once(Ok::<_, std::convert::Infallible>(entries)),
        &mut pack_bytes,
        num_entries,
        gix_pack::data::Version::V2,
        repo.object_hash(),
    );
    while let Some(result) = writer.next() {
        result?;
    }
    Ok(pack_bytes)
}
```

`gix_zlib` is already a transitive dependency of `gix-pack`; if `cargo check` reports it isn't directly resolvable by name, add `gix-zlib = { version = "0.x", default-features = false }` pinned the same way as Step 1 rather than guessing the version — check `Cargo.lock` for the exact one `gix-pack 0.74.2` already pulls in.

- [x] **Step 5: Run test to verify it passes**

Run: `cargo test --lib commands::git_mobile::tests::built_pack_is_accepted --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/commands/git_mobile.rs
git commit -m "feat(mobile): serialize an object set into pack bytes"
```

---

### Task 3: The wire exchange — handshake, ref-update-request, send, parse `report-status`

**Files:**
- Modify: `src-tauri/Cargo.toml` — add `gix-transport` as a direct dependency.
- Modify: `src-tauri/src/commands/git_mobile.rs` — replace `checked_push`'s body.

**Interfaces:**
- Consumes: `objects_missing_from_remote` (Task 1), `build_pack_bytes` (Task 2), `basic_auth_credentials` (existing helper, line 191).
- Produces: the real `checked_push`, matching its existing signature exactly — no caller-visible change (`push_notes`'s `#[tauri::command]` wrapper, already wired per `git-mobile-gix.md`'s Task 7, needs no edit).

**This is the plan's highest-risk task**, same as `git-mobile-gix.md` flagged its own deferred Task 5 — the difference is this plan has already confirmed (by reading `gix-0.87.1`'s and `gix-transport-0.59.2`'s source directly, not by guessing) that the two primitives below exist and are public:

- `Connection::transport_mut(&mut self) -> &mut T` (`gix-0.87.1/src/remote/connection/access.rs`) — the way in, since `Connection`'s `transport` field is `pub(crate)` and otherwise unreachable.
- `Transport::handshake(service: gix_transport::Service, extra_parameters: &[(&str, Option<&str>)]) -> Result<SetServiceResponse, Error>` and `Transport::request(write_mode: WriteMode, on_into_read: MessageKind, trace: bool) -> Result<RequestWriter, Error>` (`gix-transport-0.59.2/src/client/blocking_io/traits.rs`) — `RequestWriter` implements `std::io::Write` directly and `into_read()` returns the response.

What is **not** yet confirmed, and must be resolved as this task's Step 1 before writing Step 3's implementation, is the exact byte-level assembly of the ref-update-request line and the exact `report-status` response parsing calls — git's wire format for both is well-documented (git's own `Documentation/technical/pack-protocol.txt`, "Reference Update Request and Packfile Transfer" and "report-status" sections), but the precise `gix_transport`/`gix_packetline` calls to produce/consume it need confirming against source, the same way Tasks 1 and 2 did, not assumed from this plan's description of the wire format.

- [x] **Step 1: Confirm the exact `RequestWriter`/pkt-line calls before writing Step 3**

Read these two files directly (already present in the local registry cache — no network needed):
- `~/.cargo/registry/src/*/gix-transport-0.59.2/src/client/blocking_io/traits.rs` — the `TransportV2Ext::invoke` default method (lines 114–138 of that file) is a real, working example of writing a command line via `WriteMode::OneLfTerminatedLinePerWriteCall`, a `MessageKind::Flush`/`Delimiter` terminator, and `into_read()` — the receive-pack ref-update-request is structurally the same shape (one or more `<old-id> <new-id> <ref-name>\0<capabilities>` lines, a flush-pkt, then raw pack bytes with no further pkt-line wrapping), so this is the pattern to adapt, not invent from scratch. Confirm whether a single `request()` call's `RequestWriter` can be reused across both the line-mode command and the binary-mode pack (i.e., whether `write_mode` governs the whole writer or can be changed mid-stream) — if not, `gix_transport::client::blocking_io::request::RequestWriter::new_from_bufread` (line 37 of `request.rs`) is the lower-level constructor to build the request by hand instead of through `Transport::request()`.
- `~/.cargo/registry/src/*/gix-transport-0.59.2/src/client/blocking_io/traits.rs`'s `SetServiceResponse.refs: Option<Box<dyn ReadlineBufRead>>` — for protocol V1 (what receive-pack always effectively speaks, since push was never redesigned for protocol V2's command dispatch), this is the ref advertisement: `<oid> <ref-name>\0<capabilities>\n` for the first ref, `<oid> <ref-name>\n` for the rest, flush-pkt to end. Confirm `ReadlineBufRead`'s exact method for reading one pkt-line at a time (it's a `bstr`/`std::io::BufRead`-flavored trait in the same crate — grep `trait ReadlineBufRead` in that crate's `src/` for its methods) before writing the parser in Step 3.

If either investigation turns up that the shape above doesn't hold (e.g. `request()` truly can't mix line-mode and binary-mode within one call), fall back to `gix_transport::client::blocking_io::request::RequestWriter::new_from_bufread`, which takes an explicit `write_mode` per section — read its doc comment for the exact split-write pattern before proceeding.

- [x] **Step 2: Add `gix-transport` as a direct dependency**

```toml
gix-transport = { version = "0.59.2", default-features = false, features = ["client-transport"] }
```

Pin to `0.59.2` (already resolved in `Cargo.lock`) the same way Task 2 pinned `gix-pack`/`gix-object` — confirm with `cargo tree -p gix-transport` that no second copy appears. The exact feature name (`client-transport` above is this plan's best guess from `gix`'s own `Cargo.toml`, which gates its `blocking-network-client` feature through `gix-transport`'s client-side features) needs confirming against `gix-transport-0.59.2/Cargo.toml`'s `[features]` table directly — adjust if the name differs.

- [x] **Step 3: Write the failing tests**

Adapted from `git-mobile-gix.md`'s Task 5 (written when push was still believed fully blocked — corrected here now that a concrete implementation path exists), plus two new cases this task's real implementation makes testable for the first time: pushing a brand-new branch (no prior ref on the remote) and a rejected non-fast-forward push.

```rust
    #[test]
    fn pushes_new_commits_to_the_remote() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "a.md", "# A\n", "notes: update a");
        // Bare, so it can receive a push without `receive.denyCurrentBranch`
        // rejecting it — desktop's own push path never has to deal with a
        // non-bare receiver either, since it always pushes to GitHub.
        let bare = origin.path().with_extension("bare");
        assert!(Command::new("git")
            .arg("clone")
            .arg("-q")
            .arg("--bare")
            .arg(origin.path())
            .arg(&bare)
            .status()
            .unwrap()
            .success());

        let clone = tempfile::tempdir().unwrap();
        git_clone(&bare, clone.path());
        commit_file(clone.path(), "b.md", "# B\n", "notes: update b");

        let outcome =
            checked_push(&clone.path().to_string_lossy(), RepoMode::NotesOnly, false, "").unwrap();

        assert_eq!(outcome, PushOutcome::Pushed);
        let log = Command::new("git")
            .arg("-C")
            .arg(&bare)
            .arg("log")
            .arg("--oneline")
            .arg("-n1")
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&log.stdout).contains("notes: update b"));
    }

    #[test]
    fn no_remote_when_none_is_configured() {
        let tmp = tempfile::tempdir().unwrap();
        git_init(tmp.path());
        commit_file(tmp.path(), "a.md", "# A\n", "notes: update a");

        assert_eq!(
            checked_push(&tmp.path().to_string_lossy(), RepoMode::NotesOnly, false, "").unwrap(),
            PushOutcome::NoRemote
        );
    }

    #[test]
    fn refuses_a_code_repo_push_without_the_override() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "a.md", "# A\n", "notes: update a");
        let clone = tempfile::tempdir().unwrap();
        git_clone(origin.path(), clone.path());

        let result = checked_push(&clone.path().to_string_lossy(), RepoMode::CodeRepo, false, "");

        assert!(result.is_err());
    }

    #[test]
    fn pushes_a_brand_new_branch_the_remote_has_never_seen() {
        let bare = tempfile::tempdir().unwrap();
        assert!(Command::new("git")
            .arg("init")
            .arg("-q")
            .arg("--bare")
            .arg(bare.path())
            .status()
            .unwrap()
            .success());

        let clone = tempfile::tempdir().unwrap();
        git_clone(bare.path(), clone.path());
        commit_file(clone.path(), "a.md", "# A\n", "notes: first commit");

        let outcome =
            checked_push(&clone.path().to_string_lossy(), RepoMode::NotesOnly, false, "").unwrap();

        assert_eq!(outcome, PushOutcome::Pushed);
    }

    #[test]
    fn rejects_a_non_fast_forward_push() {
        let origin = tempfile::tempdir().unwrap();
        git_init(origin.path());
        commit_file(origin.path(), "a.md", "# A\n", "notes: update a");
        let bare = origin.path().with_extension("bare");
        assert!(Command::new("git")
            .arg("clone")
            .arg("-q")
            .arg("--bare")
            .arg(origin.path())
            .arg(&bare)
            .status()
            .unwrap()
            .success());

        let clone_a = tempfile::tempdir().unwrap();
        git_clone(&bare, clone_a.path());
        commit_file(clone_a.path(), "b.md", "# B\n", "notes: from clone a");
        assert_eq!(
            checked_push(&clone_a.path().to_string_lossy(), RepoMode::NotesOnly, false, "").unwrap(),
            PushOutcome::Pushed
        );

        // clone_b branched from `origin` before clone_a's push landed, so
        // its parent commit is now stale on `bare` once its remote is
        // repointed there.
        let clone_b = tempfile::tempdir().unwrap();
        git_clone(origin.path(), clone_b.path());
        commit_file(clone_b.path(), "c.md", "# C\n", "notes: from clone b");
        assert!(Command::new("git")
            .arg("-C")
            .arg(clone_b.path())
            .arg("remote")
            .arg("set-url")
            .arg("origin")
            .arg(&bare)
            .status()
            .unwrap()
            .success());

        let outcome =
            checked_push(&clone_b.path().to_string_lossy(), RepoMode::NotesOnly, false, "").unwrap();

        assert!(matches!(outcome, PushOutcome::Rejected { .. }));
    }
```

- [x] **Step 4: Run tests to verify they fail**

Run: `cargo test --lib commands::git_mobile::tests --manifest-path src-tauri/Cargo.toml`
Expected: `pushes_new_commits_to_the_remote`, `pushes_a_brand_new_branch_the_remote_has_never_seen`, and `rejects_a_non_fast_forward_push` FAIL (still hitting the `bail!` stub); `no_remote_when_none_is_configured` and `refuses_a_code_repo_push_without_the_override` already PASS (they exercise the stub's existing guard checks, unchanged by this task).

- [x] **Step 5: Implement the real `checked_push`**

```rust
pub fn checked_push(
    workspace: &str,
    mode: RepoMode,
    allow_code_repo_push: bool,
    token: &str,
) -> anyhow::Result<PushOutcome> {
    if mode == RepoMode::CodeRepo && !allow_code_repo_push {
        anyhow::bail!(
            "refusing to push a CodeRepo workspace — set allow_code_repo_push to override"
        );
    }

    let repo = gix::discover(workspace)?;
    let remote = match repo.find_default_remote(gix::remote::Direction::Push) {
        None => return Ok(PushOutcome::NoRemote),
        Some(Err(e)) => return Err(e.into()),
        Some(Ok(remote)) => remote,
    };

    let head_name = repo
        .head_name()?
        .ok_or_else(|| anyhow::anyhow!("HEAD is not a symbolic ref"))?;
    let new_id = repo.head_id()?.detach();
    let ref_name = head_name.as_bstr().to_string();

    let mut connection = remote
        .connect(gix::remote::Direction::Push)?
        .with_credentials(basic_auth_credentials(token.to_string()));

    // Step 1's investigation determines the exact handshake/ref-advertisement
    // and command/pack assembly calls below — this is the shape, not the
    // final byte-level implementation. Populate `old_id` from the parsed ref
    // advertisement (`None` if `ref_name` isn't listed — a brand-new branch).
    let transport = connection.transport_mut();
    // let response = transport.handshake(gix_transport::Service::ReceivePack, &[])?;
    // let old_id: Option<gix::ObjectId> = /* parse `response.refs` for `ref_name` */;
    let old_id: Option<gix::ObjectId> = todo!("Step 1's ref-advertisement parsing");

    if old_id == Some(new_id) {
        return Ok(PushOutcome::Pushed); // nothing to do, already up to date
    }

    let object_ids = objects_missing_from_remote(&repo, new_id, old_id)?;
    let pack_bytes = build_pack_bytes(&repo, &object_ids)?;

    let old_hex = old_id.unwrap_or_else(|| repo.object_hash().null()).to_string();
    let command_line = format!("{old_hex} {new_id} {ref_name}\0report-status\n");

    // let mut writer = transport.request(gix_transport::client::WriteMode::Binary, gix_transport::client::MessageKind::Flush, false)?;
    // writer.write_all(pkt_line_encode(&command_line).as_bytes())?;
    // writer.write_message(gix_transport::client::MessageKind::Flush)?;
    // writer.write_all(&pack_bytes)?;
    // let mut response = writer.into_read()?;
    // parse `report-status`: "unpack ok\n" then "ok <ref>\n" or "ng <ref> <reason>\n"
    let _ = (transport, command_line, pack_bytes);
    todo!("Step 1's ref-update-request assembly and report-status parsing")
}
```

Replace both `todo!()`s with Step 1's confirmed calls before Step 6. Map the parsed outcome: `report-status` "unpack ok" + "ok `<ref>`" → `PushOutcome::Pushed`; "ng `<ref>` <reason>" (non-fast-forward, stale info) → `PushOutcome::Rejected { output: reason }`; a handshake or request error whose message/status indicates authentication (HTTP 401/403 — check `gix_transport::client::Error`'s variants for one that carries an HTTP status, confirmed during Step 1) → `PushOutcome::AuthFailed { output: ... }`; anything else → propagate via `?` (matching this module's existing pattern elsewhere of not inventing a classification for cases desktop's own `git.rs` doesn't specifically classify either).

- [x] **Step 6: Run tests to verify they pass**

Run: `cargo test --lib commands::git_mobile::tests --manifest-path src-tauri/Cargo.toml`
Expected: PASS, all five.

- [x] **Step 7: Verify both platforms build and lint clean**

```bash
cd src-tauri
cargo build
cargo clippy -- -D warnings
cargo fmt --check
cargo check --target aarch64-apple-ios-sim
cargo clippy --target aarch64-apple-ios-sim -- -D warnings
```

(The iOS-target commands need the CI workflow from `docs/plans/mobile-ios-scaffold.md` if run outside a macOS host — `gh workflow run ios-scaffold.yml && gh run watch --exit-status`, same loop that plan established.)

- [x] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/commands/git_mobile.rs
git commit -m "feat(mobile): implement push_notes via gix's low-level transport"
```

---

## Out of scope (this plan)

- **Delta compression.** Every pushed object is a full base entry — see Global Constraints. Revisit only if real push payload sizes prove to matter.
- **Where the HTTPS token comes from** (iOS Keychain storage, onboarding UI) — unchanged from `git-mobile-gix.md`'s own out-of-scope note; this plan's `checked_push` accepts `token: &str` and uses it, same as `checked_pull` already does.
- **SSH or any non-HTTPS remote.** Matches the spec's existing HTTPS-only decision.
- **Retrying a rejected push, or any auto-rebase-then-push flow.** `checked_push` reports `Rejected`; the frontend's existing rebase-then-retry flow (already built against desktop's `git.rs`, which has the same `Rejected` outcome) is reused unchanged, not rebuilt here.
- **Protocol V2 command-dispatch push.** This plan targets the V1-shaped ref-update-request/pack exchange that `receive-pack` uses regardless of negotiated protocol version, since push was never redesigned for V2 — see Task 3's Step 1 note.
