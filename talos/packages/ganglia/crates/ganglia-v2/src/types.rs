use serde::{Deserialize, Serialize};

pub type Point = [f64; 3];
#[derive(Clone, Deserialize)]
pub struct Input {
    pub physical: Physical,
    #[serde(default)]
    pub marks: Vec<Mark>,
    #[serde(default)]
    pub anchors: Vec<Point>,
    #[serde(default)]
    pub layouts: Vec<Vec<Placement>>,
    #[serde(default)]
    pub links: Vec<Link>,
    #[serde(default)]
    pub config: Config,
}
#[derive(Clone, Deserialize)]
pub struct Link {
    pub from: Point,
    pub to: Point,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub seed: u64,
    pub population_size: usize,
    pub attempts_per_round: usize,
    pub stagnant_rounds: usize,
    pub improvement_threshold: f64,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            seed: 1,
            population_size: 4,
            attempts_per_round: 100,
            stagnant_rounds: 3,
            improvement_threshold: 0.001,
        }
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Physical {
    pub ground: Ground,
    pub collision: Collision,
    pub movement: Movement,
    pub locomotion: Locomotion,
    pub rounded_walls: Option<Vec<Wall>>,
    pub devices: Option<DeviceFacts>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFacts {
    pub devices: Vec<Device>,
    pub ropes: Vec<Rope>,
    #[serde(default)]
    pub moving_supports: Vec<MovingSupport>,
    #[serde(default)]
    pub following_supports: Vec<FollowingSupport>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowingSupport {
    pub id: String,
    pub spawn: Point,
    pub bodies: Vec<Vec<Point>>,
    pub geometry_kind: String,
    pub max_distance: f64,
    pub assumption: String,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Placement {
    pub device: String,
    pub position: Point,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovingSupport {
    pub id: String,
    pub family: String,
    pub assumption: String,
    pub surfaces: Vec<Surface>,
    #[serde(default)]
    pub surface_poses: Vec<Vec<PoseSpan>>,
    #[serde(default)]
    pub poses: Vec<Pose>,
    pub transfers: Vec<Transfer>,
    pub circular: Option<Circular>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoseSpan {
    pub body: usize,
    pub from_pose: usize,
    pub to_pose: usize,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Circular {
    pub center: Point,
    pub axis: Point,
    pub radius: f64,
    pub half_width: f64,
    pub sagitta: f64,
}
#[derive(Clone, Deserialize)]
pub struct Pose {
    pub min: Point,
    pub max: Point,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub body: Option<usize>,
    pub from: Point,
    pub to: Point,
    pub speed: Option<f64>,
    pub from_pose: Option<usize>,
    pub to_pose: Option<usize>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    #[serde(default)]
    pub kind: String,
    pub resolved: bool,
    pub unit_scale: bool,
    pub goal: Option<Mark>,
    #[serde(default)]
    pub seeds: Vec<Point>,
    pub speed: Option<f64>,
    pub overhead: Option<f64>,
    #[serde(default)]
    pub fixed_launch: bool,
    #[serde(default)]
    pub free_launch: bool,
    pub aim: Option<Point>,
    pub height: Option<f64>,
    pub aim_clearance: Option<f64>,
    pub duration: Option<serde_json::Value>,
    pub boost_multiplier: Option<f64>,
}
#[derive(Clone, Deserialize)]
pub struct Rope {
    pub bottom: String,
    pub top: String,
}
#[derive(Clone, Deserialize)]
pub struct Ground {
    pub surfaces: Vec<Surface>,
    pub tiles: Option<Vec<Tile>>,
    pub options: GroundOptions,
    pub build: Option<Build>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Build {
    pub bounds: Option<CoverageBounds>,
    pub tiles: Option<Vec<Tile>>,
    pub cell_size: Option<f64>,
    pub tile_cells: Option<usize>,
}
#[derive(Clone, Deserialize)]
pub struct Tile {
    pub x: i64,
    pub z: i64,
}
#[derive(Clone, Deserialize)]
pub struct CoverageBounds {
    pub min: [f64; 2],
    pub max: [f64; 2],
}
#[derive(Clone, Deserialize)]
pub struct Surface {
    pub vertices: Vec<Point>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundOptions {
    pub max_vertical: f64,
    pub profile: Profile,
    pub walls: Vec<Wall>,
}
#[derive(Clone, Deserialize)]
pub struct Profile {
    pub radius: f64,
    pub height: f64,
}
#[derive(Clone, Deserialize)]
pub struct Collision {
    pub positions: Vec<f64>,
    pub indices: Vec<usize>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Movement {
    pub model: Model,
    pub max_slope: f64,
    pub run_air_speed: f64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub gravity: f64,
    pub falling_gravity: f64,
    pub max_jump_height: f64,
    pub max_falling_speed: f64,
    pub apex_time: f64,
    pub max_horizontal_speed: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_horizontal_speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub air_overspeed_deceleration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub air_acceleration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub air_deceleration: Option<f64>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Locomotion {
    pub speed: f64,
    pub sprint_speed: Option<f64>,
    pub sprint_acceleration: Option<f64>,
    pub dash: Option<Dash>,
    pub stamina: Option<Stamina>,
    #[serde(default)]
    pub sprint_through: Vec<String>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Dash {
    pub speed: f64,
    pub duration: f64,
    pub cooldown: f64,
    pub cost: f64,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stamina {
    pub capacity: f64,
    pub initial: f64,
    #[serde(default)]
    pub activation_cost: f64,
    #[serde(default)]
    pub sprint_drain: f64,
    pub recovery_rate: f64,
    pub recovery_delay: f64,
    pub reserve: f64,
    #[serde(default)]
    pub recovery_during_sprint: bool,
    #[serde(default)]
    pub recovery_during_non_walk: bool,
}
#[derive(Clone, Deserialize)]
pub struct Wall {
    pub min: Point,
    pub max: Point,
    pub state: String,
    #[serde(default)]
    pub padding: f64,
    pub points: Option<Vec<[f64; 2]>>,
    pub polygon: Option<Vec<[f64; 2]>>,
    pub sphere: Option<Sphere>,
}
#[derive(Clone, Deserialize)]
pub struct Sphere {
    pub center: Point,
    pub radius: f64,
}
#[derive(Clone, Deserialize)]
pub struct Mark {
    pub position: Point,
    pub interaction: Interaction,
}
#[derive(Clone, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Interaction {
    #[serde(default)]
    pub airborne: bool,
    pub radius: f64,
    pub max_vertical: Option<f64>,
    pub facing: Option<Point>,
    pub half_angle: Option<f64>,
}
#[derive(Clone, Deserialize)]
pub struct Query {
    pub starts: Vec<Arrival>,
    pub goal: Point,
    pub interaction: Option<Interaction>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Arrival {
    pub id: String,
    pub position: Point,
    pub cost: f64,
    pub state: String,
}
#[derive(Clone, Serialize)]
pub struct Segment {
    #[serde(rename = "requiredGait", skip_serializing_if = "Option::is_none")]
    pub required_gait: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost: Option<BoostUse>,
    pub mode: &'static str,
    pub points: Vec<Point>,
    pub times: Vec<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flight: Option<Flight>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gait: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub traversal: Option<&'static str>,
}

#[derive(Clone, PartialEq, Serialize)]
pub struct BoostUse {
    pub id: String,
    pub multiplier: f64,
    pub duration: f64,
}
impl Segment {
    pub fn cost(&self) -> f64 {
        *self.times.last().unwrap()
    }
    pub fn start(&self) -> Point {
        self.points[0]
    }
    pub fn end(&self) -> Point {
        *self.points.last().unwrap()
    }
}
#[derive(Clone, Serialize)]
pub struct Flight {
    pub kind: &'static str,
    pub start: Point,
    pub end: Point,
    pub model: Model,
    pub control: Control,
}
#[derive(Clone, Serialize)]
pub struct Control {
    pub mode: &'static str,
}
