using Docstore.Domain.Entities;

namespace Docstore.App.Models
{
    public class FoldersIndexViewModel
    {
        public IEnumerable<Folder> Folders { get; set; } = Enumerable.Empty<Folder>();
    }
}
