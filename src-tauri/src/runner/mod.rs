pub(crate) mod protocol;
mod transport;

// 消费方（host.rs、commands）继续经 crate::runner::* 导入；合同在 protocol.rs，
// 子进程传输在 transport.rs，本模块只做 re-export。
pub use protocol::{RunnerReply, RunnerRequest};
pub use transport::RunnerProcess;

pub(crate) use transport::read_bounded_line;
