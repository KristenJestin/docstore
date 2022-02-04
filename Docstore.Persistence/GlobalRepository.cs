using Docstore.Application.Extensions;
using Docstore.Application.Interfaces;
using Docstore.Application.Models;
using Docstore.Domain.Extensions;
using Docstore.Persistence.Contexts;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Docstore.Persistence
{
    public class GlobalRepository : IGlobalRepository
    {
        private readonly ApplicationDbContext _db;

        public GlobalRepository(ApplicationDbContext dbContext)
            => _db = dbContext;


        public async Task<PagedResult<ElementItem>> GetDocumentsWithoutParentAndFolders(int userId, int pageNumber, int pageSize)
        {
            var queryDocuments = _db.Documents
                .Where(x => x.UserId == userId)
                // TODO: save in database size and count when inserting and updating files
               .Select(d => new { d.Id, d.Name, d.Description, Size = d.Files.Sum(file => file.Size), ChildrensCount = d.Files.Count, LastUpdate = d.UpdatedAt, Type = ElementItemType.Document });
            var queryFolders = _db.Folders
               .Where(f => f.UserId == userId)
               // TODO: save in database size and count when inserting and updating files
               .Select(f => new { f.Id, f.Name, f.Description, Size = f.Documents.Sum(docu => docu.Files.Sum(file => file.Size)), ChildrensCount = f.Documents.Count, LastUpdate = f.UpdatedAt, Type = ElementItemType.Folder });

            var query = queryFolders.Union(queryDocuments);

            // total
            var count = await query.CountAsync();
            // paginations
            var result = await query
                .Paginate(pageNumber, pageSize)
                .AsNoTracking()
                .OrderBy(x => x.Type)
                .ThenBy(x => x.Name)
                .ThenByDescending(x => x.LastUpdate)
                .Select(x => new ElementItem { Id = x.Id, Name = x.Name, Description = x.Description, Size = x. Size, ChildrensCount = x.ChildrensCount, LastUpdate = x.LastUpdate, Type = x.Type })
                .ToListAsync();

            // list documents
            return new PagedResult<ElementItem>(result, count, pageNumber, pageSize);
        }
    }
}
