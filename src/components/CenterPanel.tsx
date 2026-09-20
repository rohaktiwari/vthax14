import { useCenterView } from "../context/CenterViewContext";
import { useSchedule } from "../context/ScheduleContext";
import AddCourses from "./AddCourses";
import CourseDetails from "./CourseDetails";
import ScheduleOverview from "./ScheduleOverview";
import Welcome from "./Welcome";

/**
 * Center column. Shows exactly one thing: the add-a-course search, the welcome
 * screen while nothing is selected, the details of the course picked on the
 * calendar or in Your Courses, or the schedule overview.
 */
export default function CenterPanel() {
  const { crns } = useSchedule();
  const { view } = useCenterView();

  if (view.kind === "add") return <AddCourses />;
  if (crns.length === 0) return <Welcome />;
  if (view.kind === "course") return <CourseDetails />;
  return <ScheduleOverview />;
}
