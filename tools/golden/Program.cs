using System.Globalization;
using System.Text.Json;
using SignalHorizon.Sim;

// Golden-master emitter. Loads the canonical data/system.json and prints the
// pure Kepler outputs the TypeScript port must reproduce. G17 round-trips an
// IEEE-754 double exactly, so these strings ARE the bit-level truth.
//
// J2000 epoch == t=0 in this sim: epoch_seconds defaults to 0 and the m0 mean
// anomalies in system.json are defined at t=0 (see system.json _comment).

var ci = CultureInfo.InvariantCulture;

string dataPath = args.Length > 0
    ? args[0]
    : "/home/basov/Games/Godot/galaxy-link/data/system.json";

Ephemeris eph = Ephemeris.LoadFrom(dataPath);

static string F(double v) => v.ToString("G17", CultureInfo.InvariantCulture);

void Emit(string id, double t)
{
    double[] p = eph.Position(id, t);
    double[] v = eph.Velocity(id, t);
    Console.WriteLine($"  {{ \"id\": \"{id}\", \"t\": {F(t)}, \"pos\": [{F(p[0])}, {F(p[1])}, {F(p[2])}], \"vel\": [{F(v[0])}, {F(v[1])}, {F(v[2])}] }},");
}

Console.WriteLine("{");
Console.WriteLine($"  \"_note\": \"C# golden master from the REAL SignalHorizon.Sim.Ephemeris. G17 round-trip f64. epoch_jd={F(eph.EpochJd)} frame={eph.Frame}\",");
Console.WriteLine("  \"samples\": [");
// Earth at J2000 — the primary pin required by the task.
Emit("earth", 0.0);
// Cross-check companions (used as secondary pins / sanity in the TS suite).
Emit("mars", 0.0);
Emit("moon", 0.0);
Emit("earth", 123456.0);
Emit("mars", 123456.0);
Emit("sat_leo", 1500.0);
Emit("sat_geo", 21600.0);
Console.WriteLine("  ],");

// Derived per-body scalars the TS port also reproduces.
Console.WriteLine("  \"bodies\": {");
foreach (var id in new[] { "sun", "earth", "mars", "moon", "sat_leo", "sat_geo" })
{
    var b = eph.Bodies[id];
    Console.WriteLine($"    \"{id}\": {{ \"a_m\": {F(b.A)}, \"e\": {F(b.E)}, \"n_rad_s\": {F(b.N)}, \"period_s\": {F(b.PeriodSeconds())}, \"mu_parent\": {F(b.MuParent)}, \"parent\": \"{b.Parent}\" }},");
}
Console.WriteLine("    \"_end\": null");
Console.WriteLine("  }");
Console.WriteLine("}");
