import { useProfessorDrawer } from "../context/ProfessorDrawerContext";
import { instructorSurname } from "../lib/instructors";

interface InstructorLinksProps {
  /** Display names from section data, e.g. ["Ada Lovelace"]. */
  names: string[];
  className?: string;
}

/**
 * Instructor display names. Names with a usable surname become buttons that
 * open the lazily-loaded professor drawer; placeholders such as "TBA" stay plain
 * text. Uses the no-op drawer controller by default, so it renders anywhere.
 */
export default function InstructorLinks({ names, className }: InstructorLinksProps) {
  const { openProfessor } = useProfessorDrawer();

  if (!names || names.length === 0) {
    return <span className={className}>TBA</span>;
  }

  return (
    <span className={className}>
      {names.map((name, index) => {
        const surname = instructorSurname(name);
        return (
          <span key={`${name}-${index}`}>
            {index > 0 ? ", " : null}
            {surname ? (
              <button
                type="button"
                onClick={(event) =>
                  openProfessor({ surname, displayName: name }, event.currentTarget)
                }
                aria-label={`View instructor details for ${name}`}
                className="rounded underline decoration-dotted underline-offset-2 hover:text-maroon focus-visible:text-maroon"
              >
                {name}
              </button>
            ) : (
              name
            )}
          </span>
        );
      })}
    </span>
  );
}
