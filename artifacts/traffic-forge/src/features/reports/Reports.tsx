export default function Reports() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Reports</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left p-3">Date</th>
            <th className="text-left p-3">Duration</th>
            <th className="text-left p-3">Users</th>
            <th className="text-left p-3">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b text-center text-muted-foreground">
            <td colSpan={4} className="p-8">No reports yet</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
