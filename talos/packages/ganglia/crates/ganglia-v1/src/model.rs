//! Owned wire facts. Extra fields survive normalization so execution witnesses
//! can evolve without silently losing adapter metadata.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
pub type Vec3 = [f64; 3];
pub type Extra = BTreeMap<String, Value>;
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Surface {
    pub id: String,
    pub vertices: Vec<Vec3>,
    #[serde(default)]
    pub portals: Vec<usize>,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Portal {
    pub from: String,
    pub to: String,
    pub points: [Vec3; 2],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<[Vec3; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit: Option<[Vec3; 2]>,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct CollisionGeometry {
    #[serde(default)]
    pub positions: Vec<f64>,
    #[serde(default)]
    pub indices: Vec<usize>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Profile {
    pub radius: f64,
    pub height: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Bounds {
    pub min: [f64; 2],
    pub max: [f64; 2],
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Sphere {
    pub center: Vec3,
    pub radius: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Wall {
    pub min: Vec3,
    pub max: Vec3,
    pub state: String,
    #[serde(default)]
    pub padding: f64,
    pub sphere: Option<Sphere>,
    pub points: Option<Vec<[f64; 2]>>,
    pub polygon: Option<Vec<[f64; 2]>>,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Interaction {
    #[serde(default)]
    pub airborne: bool,
    pub radius: f64,
    pub max_vertical: Option<f64>,
    pub facing: Option<Vec3>,
    pub half_angle: Option<f64>,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpModel {
    pub gravity: f64,
    pub falling_gravity: f64,
    pub max_jump_height: f64,
    pub max_falling_speed: f64,
    pub apex_time: f64,
    pub max_horizontal_speed: f64,
    pub start_horizontal_speed: Option<f64>,
    pub air_overspeed_deceleration: Option<f64>,
    pub air_acceleration: Option<f64>,
    pub air_deceleration: Option<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dash {
    pub speed: f64,
    pub duration: f64,
    pub cooldown: f64,
    pub cost: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stamina {
    pub capacity: f64,
    pub initial: f64,
    #[serde(default)]
    pub activation_cost: f64,
    #[serde(default)]
    pub sprint_drain: f64,
    #[serde(default)]
    pub recovery_during_sprint: bool,
    #[serde(default)]
    pub recovery_during_non_walk: bool,
    pub recovery_rate: f64,
    pub recovery_delay: f64,
    pub reserve: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Locomotion {
    pub speed: f64,
    pub sprint_speed: f64,
    pub sprint_acceleration: f64,
    pub dash: Option<Dash>,
    #[serde(default)]
    pub sprint_through: Vec<Mode>,
    pub stamina: Option<Stamina>,
    #[serde(default)]
    pub search: Value,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum Mode {
    #[default]
    Walk,
    Rope,
    Jump,
    Drop,
    Launch,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BoostUse {
    pub id: String,
    pub multiplier: f64,
    pub duration: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Boost {
    #[serde(flatten)]
    pub effect: BoostUse,
    pub position: Vec3,
    pub interaction: Interaction,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub mode: Mode,
    pub points: Vec<Vec3>,
    pub times: Vec<f64>,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub traversal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_boost: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint_tolerance: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_gait: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_surface: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_surface: Option<String>,
    #[serde(flatten)]
    pub extra: Extra,
}
impl Connection {
    pub fn new(id: String, mode: Mode, points: Vec<Vec3>, times: Vec<f64>) -> Self {
        Self {
            id,
            mode,
            points,
            times,
            state: "open".into(),
            traversal: None,
            terminal: None,
            required_boost: None,
            endpoint_tolerance: None,
            required_gait: None,
            from_surface: None,
            to_surface: None,
            extra: Extra::new(),
        }
    }
    pub fn duration(&self) -> f64 {
        self.times.last().copied().unwrap_or(0.)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub mode: Mode,
    pub points: Vec<Vec3>,
    pub times: Vec<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub traversal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gait: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_gait: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost: Option<BoostUse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost_expiry: Option<f64>,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Arrival {
    pub id: String,
    pub position: Vec3,
    pub cost: f64,
    pub state: String,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Query {
    pub starts: Vec<Arrival>,
    pub goal: Vec3,
    pub interaction: Option<Interaction>,
    #[serde(default)]
    pub waypoints: Vec<Vec3>,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum Route {
    Complete {
        start: String,
        cost: f64,
        #[serde(rename = "arrivalCost")]
        arrival_cost: f64,
        length: f64,
        points: Vec<Vec3>,
        segments: Vec<Segment>,
        #[serde(flatten)]
        extra: Extra,
    },
    Unmapped {
        #[serde(flatten)]
        extra: Extra,
    },
    NoVerifiedRoute {
        #[serde(flatten)]
        extra: Extra,
    },
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_attempts: Option<usize>,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteResult {
    pub route: Route,
    pub connections: Vec<Connection>,
    pub diagnostics: Diagnostics,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrival: Option<Arrival>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grounded_target: Option<Vec3>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub support_boxes: Vec<SupportBox>,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SupportBox {
    pub min: Vec3,
    pub max: Vec3,
    pub device: String,
    pub family: String,
    pub role: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DeviceGoal {
    pub position: Vec3,
    pub interaction: Interaction,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub kind: String,
    pub position: Vec3,
    pub goal: Option<DeviceGoal>,
    #[serde(default)]
    pub seeds: Vec<Vec3>,
    #[serde(default)]
    pub unit_scale: bool,
    #[serde(default)]
    pub resolved: bool,
    #[serde(default)]
    pub speed: f64,
    #[serde(default)]
    pub overhead: f64,
    #[serde(default)]
    pub duration: Value,
    #[serde(default)]
    pub fixed_launch: bool,
    #[serde(default)]
    pub aim: Value,
    #[serde(default)]
    pub height: f64,
    #[serde(default)]
    pub aim_clearance: f64,
    #[serde(default)]
    pub boost_multiplier: f64,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Rope {
    pub bottom: String,
    pub top: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub from: Vec3,
    pub to: Vec3,
    pub speed: Option<f64>,
    pub from_pose: Option<usize>,
    pub to_pose: Option<usize>,
    pub body: Option<usize>,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovingSupport {
    pub id: String,
    pub family: String,
    pub surfaces: Vec<Surface>,
    #[serde(default)]
    pub transfers: Vec<Transfer>,
    pub assumption: String,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowingSupport {
    pub id: String,
    pub spawn: Vec3,
    pub bodies: Vec<Vec<Vec3>>,
    pub geometry_kind: String,
    pub max_distance: f64,
    pub initial_state: f64,
    pub assumption: String,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Devices {
    #[serde(default)]
    pub devices: Vec<Device>,
    #[serde(default)]
    pub ropes: Vec<Rope>,
    #[serde(default)]
    pub moving_supports: Vec<MovingSupport>,
    #[serde(default)]
    pub following_supports: Vec<FollowingSupport>,
    #[serde(flatten)]
    pub extra: Extra,
}
#[derive(Clone, Debug)]
pub struct Movement {
    pub speed: f64,
    pub max_vertical: f64,
    pub profile: Profile,
    pub model: JumpModel,
    pub run_air_speed: f64,
    pub max_slope: f64,
    pub max_drop: f64,
    pub max_horizontal_distance: f64,
    pub step_up: f64,
    pub step_down: f64,
    pub active_boost: Option<String>,
}
pub type RouteQuery = Query;
pub type GroundArrival = Arrival;
pub type GroundConnection = Connection;
pub type MovementMode = Mode;
pub type LocomotionOptions = Locomotion;
