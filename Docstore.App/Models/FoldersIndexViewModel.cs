using Docstore.Application.Models;
using Docstore.Domain.Entities;

namespace Docstore.App.Models
{
    public class FoldersIndexViewModel
    {
        public PagedResult<Folder> Folders { get; set; } = PagedResult<Folder>.Empty<Folder>();
    }
}
